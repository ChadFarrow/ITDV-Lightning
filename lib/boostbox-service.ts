/**
 * BoostBox integration service
 * Posts boost metadata to a BoostBox instance (tardbox.com)
 */

import { appNameOf, feedTitleOf, senderNameOf, type BoostAction, type BoostMetadata } from '@/lib/boostagram';

export async function postToBoostBox(
  amount: number,
  boostMetadata: BoostMetadata,
  // The same action as the keysend's TLV: an auto boost is "auto" in both.
  action: BoostAction = 'boost'
): Promise<{ id: string; url: string; desc: string } | null> {
  const url = process.env.NEXT_PUBLIC_BOOSTBOX_URL;
  const apiKey = process.env.NEXT_PUBLIC_BOOSTBOX_API_KEY;

  if (!url || !apiKey) {
    return null;
  }

  const valueMsat = amount * 1000;

  const body = {
    action,
    split: 1.0,
    value_msat: valueMsat,
    value_msat_total: valueMsat,
    timestamp: new Date().toISOString(),
    message: boostMetadata.message || '',
    app_name: appNameOf(boostMetadata),
    sender_name: senderNameOf(boostMetadata),
    feed_guid: boostMetadata.podcastFeedGuid || '',
    // The feed title, as in the TLV `podcast`: the album, not the artist.
    feed_title: feedTitleOf(boostMetadata),
    item_guid: boostMetadata.itemGuid || '',
    item_title: boostMetadata.title || '',
    publisher_guid: boostMetadata.publisherGuid || '',
  };

  try {
    const response = await fetch(`${url}/boost`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': apiKey,
      },
      body: JSON.stringify(body),
    });

    if (response.status === 201) {
      const data = await response.json();
      console.log('✅ BoostBox post successful:', data);
      return data;
    }

    console.warn(`⚠️ BoostBox post failed with status ${response.status}`);
    return null;
  } catch (error) {
    console.warn('⚠️ BoostBox post failed:', error);
    return null;
  }
}
