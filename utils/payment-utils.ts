/**
 * Utility functions for Lightning payments
 */

import { buildBoostagram, TLV_BOOSTAGRAM, TLV_TIP_NOTE, type BoostMetadata } from '@/lib/boostagram';

interface PaymentRecipient {
  address: string;
  split: number;
  name?: string;
  fee?: boolean;
  type?: string;
  fixedAmount?: number;
}

/**
 * Records for one auto-boost keysend, as UTF-8 text keyed by TLV type: the shape WebLN
 * keysend takes, because the wallet encodes each value itself. This used to put hex
 * here, so every receiver got hex text instead of JSON in 7629169. It used to send only
 * five fields as well (no feed, GUIDs or album); the shared builder gives it the same
 * set as a manual boost, with action "auto", which BoostBox and Helipad also record.
 * Commit 1ca4115 cut the set down after the Alby extension answered 500. The code it
 * replaced passed an array as customRecords, which a wallet reads as TLV types 0, 1
 * and 2. The full set as text is what the manual boost sends through the same WebLN.
 */
function createAutoBoostRecords(metadata: BoostMetadata, recipientName: string | undefined, amountSats: number, totalSats: number) {
  const customRecords: Record<number, string> = {};
  customRecords[TLV_TIP_NOTE] = `Auto boost: ${metadata.title || 'Unknown Track'} by ${metadata.artist || 'Unknown Artist'}`;
  customRecords[TLV_BOOSTAGRAM] = JSON.stringify(
    buildBoostagram(metadata, { action: 'auto', amountSats, totalSats, recipientName })
  );
  return customRecords;
}

/**
 * Make a Lightning payment using WebLN for auto boost
 */
export async function makeAutoBoostPayment({
  amount,
  description,
  recipients,
  fallbackRecipient,
  boostMetadata,
}: {
  amount: number;
  description: string;
  recipients?: PaymentRecipient[];
  fallbackRecipient: string;
  boostMetadata?: BoostMetadata;
}): Promise<{ success: boolean; results?: any[]; error?: string }> {
  try {
    // Check connection state
    const weblnExists = !!(window as any).webln;
    const weblnEnabled = weblnExists && !!(window as any).webln?.enabled;

    // Auto boost requires WebLN wallet connection
    if (!weblnExists) {
      return {
        success: false,
        error: 'Auto boost requires a WebLN wallet connection. Please connect your wallet to enable auto boost.'
      };
    }

    // Determine payments to make
    let paymentsToMake: PaymentRecipient[] = [];

    if (recipients && recipients.length > 0) {
      paymentsToMake = recipients.filter(r => r.address && (r.split > 0 || r.fixedAmount));
    }

    // Fallback to single recipient if no valid recipients
    if (paymentsToMake.length === 0) {
      paymentsToMake = [{
        address: fallbackRecipient,
        split: 100,
        name: 'Default',
        type: 'node'
      }];
    }

    const totalSplit = paymentsToMake.reduce((sum, r) => sum + r.split, 0);
    const results: any[] = [];

    // Use WebLN for payments
    if (weblnExists) {
      const webln = (window as any).webln;

      // Ensure WebLN is enabled
      if (!weblnEnabled) {
        await webln.enable();
      }

      // Check if we can use keysend (for node addresses)
      const hasKeysend = typeof webln.keysend === 'function';
      
      if (hasKeysend) {
        const paymentPromises = paymentsToMake.map(async (recipientData) => {
          const recipientAmount = (recipientData as any).fixedAmount || Math.floor((amount * recipientData.split) / totalSplit);
          
          // Create TLV records for boost metadata
          const customRecords = boostMetadata ? createAutoBoostRecords(boostMetadata, recipientData.name, recipientAmount, amount) : {};
          
          const response = await webln.keysend({
            destination: recipientData.address,
            amount: recipientAmount,
            customRecords
          });
          
          return { recipient: recipientData.name || recipientData.address, amount: recipientAmount, response };
        });

        const paymentResults = await Promise.allSettled(paymentPromises);
        
        paymentResults.forEach((result, index) => {
          if (result.status === 'fulfilled') {
            results.push(result.value);
          } else {
            const recipientName = paymentsToMake[index].name || paymentsToMake[index].address;
            console.error(`❌ WebLN auto boost payment failed to ${recipientName}:`, result.reason);
          }
        });

        if (results.length > 0) {
          return { success: true, results };
        } else {
          throw new Error('All WebLN auto boost payments failed');
        }
      } else {
        throw new Error('Keysend not available for auto boost payments');
      }
    } else {
      throw new Error('No payment method available for auto boost');
    }

  } catch (error) {
    console.error('Auto boost payment failed:', error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Auto boost payment failed'
    };
  }
}