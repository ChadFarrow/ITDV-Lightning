# Feature Flag Testing Checklist

## 🧪 **Basic Mode Testing** (NEXT_PUBLIC_ENABLE_LIGHTNING=false)

### Quick Switch to Basic Mode:
```bash
npm run dev:basic
# or
cp .env.basic .env.local && npm run dev
```

### ✅ **What Should be HIDDEN:**
- [ ] **Header**: No Lightning wallet button (top right)
- [ ] **Homepage**: No boost modal when clicking album cards  
- [ ] **Album Pages**: No orange "Boost" button next to Play Album
- [ ] **Track Lists**: No "Boost" buttons on individual tracks
- [ ] **Album Pages**: No boost modals should open

### ✅ **What Should Still WORK:**
- [ ] **Music playback**: Albums and tracks play normally
- [ ] **Navigation**: All links and pages load correctly
- [ ] **Album backgrounds**: Beautiful vibrant artwork displays
- [ ] **Track lists**: All tracks display and are clickable
- [ ] **Responsive design**: Mobile and desktop layouts work
- [ ] **Search/filtering**: Controls bar functions normally

---

## ⚡ **Lightning Mode Testing** (NEXT_PUBLIC_ENABLE_LIGHTNING=true)

### Quick Switch to Lightning Mode:
```bash
npm run dev:lightning  
# or
cp .env.lightning .env.local && npm run dev
```

### ✅ **What Should be VISIBLE:**
- [ ] **Header**: Lightning wallet button appears (top right)
- [ ] **Album Pages**: Orange "Boost" button next to Play Album
- [ ] **Track Lists**: Orange "Boost" buttons on each track
- [ ] **Album Pages**: Boost modals open when clicking boost buttons
- [ ] **Homepage**: Boost modal functionality (if implemented)

### ✅ **What Should Still WORK:**
- [ ] **All Basic Mode features**: Everything from basic mode works
- [ ] **Lightning features**: Boost buttons clickable (even if no wallet)
- [ ] **Modals**: Boost modals open/close properly
- [ ] **No errors**: Console shows no JavaScript errors

---

## 🔧 **Build Testing**

### Test Build Scripts:
```bash
# Test Lightning build
npm run build:lightning
ls -la .next/

# Test Basic build  
npm run build:basic
ls -la .next/

# Test both builds
npm run build:both
ls -la .next* 
```

### ✅ **Build Verification:**
- [ ] **Lightning build**: Completes without errors
- [ ] **Basic build**: Completes without errors  
- [ ] **File sizes**: Basic build should be slightly smaller (tree-shaking)
- [ ] **Environment variables**: Correct values in build output

---

## 🌐 **Production Deployment Test**

### Manual Verification URLs:
```bash
# After deployment
# Lightning version: https://itdv.podtards.com
# Basic version: https://itdv.podtards.com  
```

### ✅ **Production Checklist:**
- [ ] **Lightning site**: Shows wallet button and boost features
- [ ] **Basic site**: Clean music site, no Lightning features
- [ ] **Performance**: Both sites load quickly
- [ ] **Content sync**: Same albums/artists on both sites

---

## 🚨 **Error Scenarios to Test**

### ✅ **Edge Cases:**
- [ ] **Missing .env.local**: App defaults gracefully
- [ ] **Invalid environment values**: No crashes
- [ ] **Feature flag changes**: Hot reload works correctly
- [ ] **Browser refresh**: Settings persist correctly

---

## 📋 **Quick Test Commands**

```bash
# Switch modes quickly
npm run dev:basic     # Test basic version
npm run dev:lightning # Test Lightning version

# Build both versions
npm run build:both

# Check current mode
cat .env.local | grep ENABLE_LIGHTNING
```

---

## ✅ **Testing Status**

**Basic Mode:**
- [ ] Header (no wallet button)
- [ ] Homepage (no boost features) 
- [ ] Album pages (no boost buttons)
- [ ] Track lists (no boost buttons)
- [ ] All music features work

**Lightning Mode:**
- [ ] Header (wallet button visible)
- [ ] Album pages (boost buttons visible)  
- [ ] Track lists (boost buttons visible)
- [ ] Boost modals work
- [ ] All music features work

**Build System:**
- [ ] npm scripts work
- [ ] Builds complete successfully
- [ ] Environment switching works

---

Ready for production deployment to both domains! 🚀