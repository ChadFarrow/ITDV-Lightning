const { generateSecretKey, getPublicKey, nip19 } = require('nostr-tools');

// Generate new Nostr keys for the site
const secretKey = generateSecretKey();
const publicKey = getPublicKey(secretKey);

// Encode as nsec/npub for easy use
const nsec = nip19.nsecEncode(secretKey);
const npub = nip19.npubEncode(publicKey);

console.log('Generated Nostr keys for HPM Lightning site:');
console.log('');
// The nsec is a PRIVATE key. It must never carry the NEXT_PUBLIC_ prefix —
// Next inlines those into the client bundle at build time, which would publish
// the key to every visitor. Only /api/nostr/publish reads it, server-side.
console.log('SITE_NOSTR_NSEC=' + nsec + '        # PRIVATE — server only, never NEXT_PUBLIC_');
console.log('NEXT_PUBLIC_SITE_NOSTR_NPUB=' + npub + '  # public key, safe to ship');
console.log('');
console.log('Public key (hex):', publicKey);
console.log('Profile URL: https://primal.net/p/' + npub);
