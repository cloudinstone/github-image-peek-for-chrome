//  GitHub Image Peek - popup script
// Manages user settings

document.addEventListener('DOMContentLoaded', () => {
    // Load saved settings
    loadSettings();

    // Add event listeners for changes
    document.getElementById('enable-images').addEventListener('change', saveSettings);
    document.getElementById('expand-by-default').addEventListener('change', saveSettings);
});

function loadSettings() {
    chrome.storage.sync.get(['showImages', 'enableImages'], (result) => {
        if (result.showImages !== undefined) {
            document.getElementById('expand-by-default').checked = result.showImages;
        }

        if (result.enableImages !== undefined) {
            document.getElementById('enable-images').checked = result.enableImages;
        } else {
            // Default to enabled if setting doesn't exist
            document.getElementById('enable-images').checked = true;
        }
    });
}

function saveSettings() {
    const showImages = document.getElementById('expand-by-default').checked;
    const enableImages = document.getElementById('enable-images').checked;

    chrome.storage.sync.set({
        showImages: showImages,
        enableImages: enableImages
    }, () => {
        // Show success message briefly
        const status = document.getElementById('status');
        status.classList.add('show');

        // Hide the message after 1.5 seconds
        setTimeout(() => {
            status.classList.remove('show');
        }, 1500);

        // Tell active tabs to reload
        chrome.tabs.query({ url: "https://github.com/search*" }, (tabs) => {
            tabs.forEach(tab => {
                chrome.tabs.sendMessage(tab.id, { action: "settingsChanged" })
                    .catch(() => {/* Ignore errors for inactive tabs */ });
            });
        });
    });
} 