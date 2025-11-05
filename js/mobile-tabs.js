// Mobile Tab Switcher for Dashboard
document.addEventListener('DOMContentLoaded', function() {
  const tabSwitcher = document.querySelector('.mobile-tab-switcher');
  const tabButtons = document.querySelectorAll('.mobile-tab-btn');
  const midSection = document.querySelector('.mid');
  const rightSection = document.querySelector('.right');
  
  // Check if mobile view
  function isMobile() {
    return window.innerWidth <= 600;
  }
  
  // Show/hide tab switcher based on screen size
  function toggleTabSwitcher() {
    if (isMobile()) {
      if (tabSwitcher) tabSwitcher.style.display = 'flex';
      // Initially show mid, hide right
      if (midSection) midSection.classList.remove('hidden');
      if (rightSection) rightSection.classList.add('hidden');
    } else {
      if (tabSwitcher) tabSwitcher.style.display = 'none';
      // Show both sections on desktop
      if (midSection) midSection.classList.remove('hidden');
      if (rightSection) rightSection.classList.remove('hidden');
    }
  }
  
  // Handle tab switching
  function switchTab(tabName) {
    tabButtons.forEach(btn => {
      if (btn.dataset.tab === tabName) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });
    
    if (tabName === 'mid') {
      if (midSection) midSection.classList.remove('hidden');
      if (rightSection) rightSection.classList.add('hidden');
    } else if (tabName === 'right') {
      if (midSection) midSection.classList.add('hidden');
      if (rightSection) rightSection.classList.remove('hidden');
    }
  }
  
  // Add click handlers to tab buttons
  tabButtons.forEach(btn => {
    btn.addEventListener('click', function() {
      const tabName = this.dataset.tab;
      switchTab(tabName);
    });
  });
  
  // Initialize on load
  toggleTabSwitcher();
  
  // Handle window resize
  let resizeTimer;
  window.addEventListener('resize', function() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function() {
      toggleTabSwitcher();
      // Reset to mid tab on resize
      if (isMobile()) {
        switchTab('mid');
      }
    }, 100);
  });
});

