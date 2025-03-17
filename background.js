// GitHub Repo Images Peek - background script
// Initializes extension settings

// Listen for installation
chrome.runtime.onInstalled.addListener(() => {
    // Set default settings when installed
    chrome.storage.sync.set({
        showImages: true,
        enableImages: true
    });
}); 