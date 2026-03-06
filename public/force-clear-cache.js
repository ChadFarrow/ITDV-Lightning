
// Comprehensive cache clearing script for production
if (typeof window !== 'undefined') {
  console.log('🧹 FORCE CLEARING ALL PRODUCTION CACHES...');
  
  // Clear localStorage
  try { localStorage.clear(); console.log('🗑️  localStorage cleared'); } catch (e) { console.log('⚠️  localStorage not available'); }

  // Clear sessionStorage
  try { sessionStorage.clear(); console.log('🗑️  sessionStorage cleared'); } catch (e) { console.log('⚠️  sessionStorage not available'); }
  
  // Clear all caches
  if ('caches' in window) {
    caches.keys().then(cacheNames => {
      console.log('🗑️  Found caches:', cacheNames);
      cacheNames.forEach(cacheName => {
        console.log('🗑️  Deleting cache:', cacheName);
        caches.delete(cacheName);
      });
    });
  }
  
  // Force service worker update
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations().then(registrations => {
      registrations.forEach(registration => {
        registration.unregister();
        console.log('🔄 Service worker unregistered');
      });
    });
  }
  
  // Clear IndexedDB
  if ('indexedDB' in window) {
    indexedDB.databases().then(databases => {
      databases.forEach(db => {
        if (db.name) {
          indexedDB.deleteDatabase(db.name);
          console.log('🗑️  IndexedDB deleted:', db.name);
        }
      });
    });
  }
  
  // Force page reload after clearing
  setTimeout(() => {
    console.log('🔄 Reloading page after cache clear...');
    window.location.reload(true);
  }, 1000);
  
  console.log('✅ All production caches cleared');
}
