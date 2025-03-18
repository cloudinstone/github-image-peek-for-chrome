// GitHub Repo Pic Peek - content script
// Injects README images into GitHub search results

class GitHubRepoPicPeek {
    constructor() {
        this.processedRepos = new Set(); // Track processed repositories
        this.showImages = false;  // Controls if containers are visible 
        this.enableImages = true; // Controls if extension is enabled
        // Fixed image size thresholds (not configurable)
        this.minImageWidth = 400;
        this.minImageHeight = 300;
    }

    async init() {
        // Check if we're on a GitHub repository search page
        if (!this.isRepoSearchPage()) {
            return;
        }

        // Always set up the message listener, regardless of enabled state
        chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
            if (message.action === "settingsChanged") {
                // Reload the page to apply new settings
                window.location.reload();
                sendResponse({ status: "reloading" });
            }
            return true;
        });

        // Load settings from storage
        try {
            const result = await chrome.storage.sync.get(['showImages', 'enableImages']);
            this.showImages = result.showImages ?? false;
            this.enableImages = result.enableImages ?? true;

            // If extension is disabled, don't proceed with initialization
            if (!this.enableImages) {
                return;
            }
        } catch (error) {
            console.error('Failed to load settings:', error);
        }

        // Add expand/collapse button to the search results page
        this.addExpandCollapseButton();

        // Process initial search results
        this.processSearchResults();

        // Observe for dynamically loaded content
        this.observeSearchResults();
    }

    isRepoSearchPage() {
        // Check if the current URL is a GitHub repositories search page
        const url = window.location.href;
        return url.includes('github.com/search') &&
            (url.includes('type=repositories') ||
                document.querySelector('a.menu-item.selected[href*="type=repositories"]'));
    }

    observeSearchResults() {
        // Set up mutation observer to detect new search results
        this.observer = new MutationObserver((mutations) => {
            let shouldProcess = false;

            for (const mutation of mutations) {
                if (mutation.addedNodes && mutation.addedNodes.length) {
                    shouldProcess = true;
                    break;
                }
            }

            if (shouldProcess && this.enableImages) {
                this.addExpandCollapseButton();
                this.processSearchResults();
            }
        });

        // Target element to observe (search results container)
        const resultsContainer = document.querySelector('.JcuiZ');
        if (resultsContainer) {
            this.observer.observe(resultsContainer, { childList: true, subtree: true });
        }
    }

    processSearchResults() {
        // Find all repository results based on latest GitHub UI structure
        const repoResults = document.querySelectorAll('[data-testid="results-list"] > div');


        repoResults.forEach(async (result) => {
            // Extract repo information
            const repoLink = result.querySelector('a[class*="prc-Link-Link"]') || result.querySelector('a');
            if (!repoLink) return;

            const repoFullName = repoLink.textContent.trim();


            // Skip if already processed
            if (this.processedRepos.has(repoFullName)) return;
            this.processedRepos.add(repoFullName);

            try {
                // Get README images directly from repo page
                const images = await this.getReadmeImagesFromPage(repoFullName);

                // If images found, inject them
                if (images && images.length > 0) {

                    this.injectImages(result, images, repoFullName);
                }
            } catch (error) {
                console.error(`Error processing ${repoFullName}:`, error);
            }
        });
    }

    async getReadmeImagesFromPage(repoFullName) {

        try {
            // Fetch the repository page HTML
            const response = await fetch(`https://github.com/${repoFullName}`);
            if (!response.ok) throw new Error(`Failed to fetch repo page: ${response.status}`);

            const html = await response.text();

            // Extract images from the repo page
            return this.extractImagesFromRepoPage(html, repoFullName);
        } catch (error) {
            console.error(`Failed to get README images for ${repoFullName}:`, error);
            return [];
        }
    }

    async extractImagesFromRepoPage(html, repoFullName) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');

        // Find readme content
        const readmeContent = doc.querySelector('article.markdown-body');
        if (!readmeContent) {

            return [];
        }

        // Extract all images
        const imgElements = readmeContent.querySelectorAll('img');
        let imagePromises = [];

        // Create an array of promises for image processing
        imgElements.forEach(img => {
            const src = img.src;
            if (src) {
                const normalizedUrl = this.normalizeImageUrl(src, repoFullName);
                if (normalizedUrl && !this.isBadgeOrIcon(normalizedUrl)) {
                    // Add a promise for each image check
                    const imagePromise = this.checkImageSize(normalizedUrl)
                        .then(isLargeEnough => {
                            if (isLargeEnough) {
                                return normalizedUrl; // Return the URL if image is large enough
                            } else {

                                return null; // Return null if image is too small
                            }
                        })
                        .catch(err => {
                            console.error(`Error checking image size: ${err.message}`);
                            return normalizedUrl; // On error, include the image anyway
                        });

                    imagePromises.push(imagePromise);
                }
            }
        });

        // Wait for all image checks to complete
        const results = await Promise.all(imagePromises);

        // Filter out null values (images that were too small)
        const images = results.filter(url => url !== null);


        return images;
    }

    async checkImageSize(url) {

        return new Promise((resolve, reject) => {
            const img = new Image();

            img.onload = () => {
                // Check if image meets minimum size requirements
                const isLargeEnough = img.width >= this.minImageWidth && img.height >= this.minImageHeight;

                resolve(isLargeEnough);
            };

            img.onerror = () => {
                // If we can't load the image, reject
                console.error(`Failed to load image: ${url}`);
                reject(new Error('Failed to load image for size check'));
            };

            // Start loading the image
            img.src = url;
        });
    }

    normalizeImageUrl(url, repoFullName) {
        // Skip empty URLs
        if (!url) return null;

        // Skip SVG icons and badges (common in READMEs)
        if (this.isBadgeOrIcon(url)) return null;

        // Handle relative URLs
        if (url.startsWith('./') || url.startsWith('../') || (!url.startsWith('http') && !url.startsWith('/'))) {
            return `https://github.com/${repoFullName}/raw/HEAD/${url.replace(/^[\.\/]+/, '')}`;
        }

        // Handle root-relative URLs
        if (url.startsWith('/')) {
            const [owner, repo] = repoFullName.split('/');
            if (url.startsWith(`/${owner}/${repo}/blob/`)) {
                return url.replace(`/${owner}/${repo}/blob/`, `/${owner}/${repo}/raw/`);
            }
            return `https://github.com${url}`;
        }

        // Handle GitHub camo URLs (already proxied)
        if (url.includes('camo.githubusercontent.com')) {
            return url;
        }

        return url;
    }

    isBadgeOrIcon(url) {
        // Check common badge and icon services
        const badgePatterns = [
            'shields.io',
            'badge.fury.io',
            'badges.gitter.im',
            'travis-ci.org',
            'travis-ci.com',
            'circleci.com',
            'github.com/badges',
            'codecov.io',
            'coveralls.io',
            'inch-ci.org',
            'img.shields.io',
            'hits.dwyl.com',
            'forthebadge.com',
            'flat.badgen.net',
            'packagephobia.now.sh',
            'badgen.net'
        ];

        // Check if URL contains any badge patterns
        return badgePatterns.some(pattern => url.includes(pattern));
    }

    injectImages(resultElement, images, repoName) {
        // Create unique gallery ID for this repo
        const galleryId = `repo-pic-peek-${repoName.replace(/[^a-zA-Z0-9]/g, '-')}`;

        // Create images container
        const imagesContainer = document.createElement('div');
        imagesContainer.className = 'repo-pic-peek-container';

        // If we're not showing images by default, hide the container
        if (!this.showImages) {
            imagesContainer.style.display = 'none';
        }

        // Add image gallery
        const gallery = document.createElement('div');
        gallery.className = 'repo-pic-peek-gallery';
        gallery.id = galleryId;

        // Always limit visible images to 4 initially
        const maxVisibleImages = Math.min(images.length, 4);

        for (let i = 0; i < images.length; i++) {
            const imgWrapper = document.createElement('div');
            // Images beyond maxVisibleImages are hidden
            imgWrapper.className = i >= maxVisibleImages ? 'repo-pic-peek-img-wrapper hidden' : 'repo-pic-peek-img-wrapper';
            imgWrapper.dataset.index = i;
            imgWrapper.dataset.galleryId = galleryId;

            const img = document.createElement('img');
            img.src = images[i];
            img.alt = `${repoName} README image ${i + 1}`;
            img.className = 'repo-pic-peek-img';
            img.loading = 'lazy';

            img.addEventListener('error', () => {
                imgWrapper.remove(); // Remove image on load error
            });

            imgWrapper.addEventListener('click', (e) => {
                this.openImageViewer(galleryId, i, images);
            });

            imgWrapper.appendChild(img);
            gallery.appendChild(imgWrapper);
        }

        // Add "image count" indicator if needed
        if (images.length > maxVisibleImages) {
            const moreIndicator = document.createElement('span');
            moreIndicator.className = 'repo-pic-peek-count';
            moreIndicator.textContent = `${images.length} images`;

            // Fix the click event here to open the image viewer
            moreIndicator.addEventListener('click', () => {
                this.openImageViewer(galleryId, maxVisibleImages, images);
            });

            imagesContainer.prepend(moreIndicator);
        }

        // Store images array in a custom property on the gallery element
        gallery.dataset.images = JSON.stringify(images);

        imagesContainer.appendChild(gallery);
        resultElement.appendChild(imagesContainer);

        // Ensure we have a viewer
        this.ensureImageViewer();
    }

    // Add an expand/collapse all button to the search results container
    addExpandCollapseButton() {
        // Try to find the container where we want to add our button
        const resultsHeader = document.querySelector('div.eSmpuO');
        if (!resultsHeader) return;

        if (document.querySelector('.repo-pic-peek-toggle-btn')) return;

        // Create the button
        const button = document.createElement('button');
        button.className = 'repo-pic-peek-toggle-btn';
        button.textContent = this.showImages ? 'Hide Images' : 'Show Images';

        // Add event listener
        button.addEventListener('click', () => {
            this.toggleAllImages();
        });

        // Add to the page
        resultsHeader.prepend(button);
    }

    // Toggle all image containers between shown and hidden states
    toggleAllImages() {
        this.showImages = !this.showImages;

        // Find all image containers
        const containers = document.querySelectorAll('.repo-pic-peek-container');

        containers.forEach(container => {
            // Simply show or hide the entire container
            container.style.display = this.showImages ? '' : 'none';
        });

        // Update the button text
        const toggleBtn = document.querySelector('.repo-pic-peek-toggle-btn');
        if (toggleBtn) {
            toggleBtn.textContent = this.showImages ? 'Hide Images' : 'Show Images';
        }

        // Save the new preference to storage
        chrome.storage.sync.set({ showImages: this.showImages });
    }

    openImageViewer(galleryId, index, images) {
        // Get or create the image viewer
        const viewer = this.ensureImageViewer();

        // Set the current gallery and index
        viewer.dataset.currentGallery = galleryId;
        viewer.dataset.currentIndex = index;
        viewer.dataset.totalImages = images.length;

        // Update the main image
        const mainImage = viewer.querySelector('.image-viewer-main img');
        mainImage.src = images[index];
        mainImage.alt = `Image ${index + 1} of ${images.length}`;

        // Update counter
        const counter = viewer.querySelector('.image-viewer-counter');
        counter.textContent = `${index + 1} / ${images.length}`;

        // Show the dialog
        viewer.showModal();

        // Focus the dialog for keyboard navigation
        viewer.focus();
    }

    ensureImageViewer() {
        // Check if we already have a viewer
        let viewer = document.getElementById('repo-pic-peek-viewer');

        if (!viewer) {
            // Create the viewer
            viewer = document.createElement('dialog');
            viewer.id = 'repo-pic-peek-viewer';
            viewer.className = 'image-viewer-dialog';

            // Create the viewer content
            viewer.innerHTML = `
                <div class="image-viewer-content">
                    <button class="image-viewer-close" aria-label="Close">&times;</button>
                    <button class="image-viewer-prev" aria-label="Previous image">&lsaquo;</button>
                    <button class="image-viewer-next" aria-label="Next image">&rsaquo;</button>
                    
                    <div class="image-viewer-main">
                        <img src="" alt="" />
                    </div>
                    
                    <div class="image-viewer-controls">
                        <span class="image-viewer-counter">0 / 0</span>
                        <button class="image-viewer-zoom-in" aria-label="Zoom in">+</button>
                        <button class="image-viewer-zoom-out" aria-label="Zoom out">-</button>
                        <button class="image-viewer-reset" aria-label="Reset zoom">Reset</button>
                    </div>
                </div>
            `;

            // Add event listeners
            const closeBtn = viewer.querySelector('.image-viewer-close');
            closeBtn.addEventListener('click', () => {
                viewer.close();
            });

            const prevBtn = viewer.querySelector('.image-viewer-prev');
            prevBtn.addEventListener('click', () => {
                this.navigateImage(-1, viewer);
            });

            const nextBtn = viewer.querySelector('.image-viewer-next');
            nextBtn.addEventListener('click', () => {
                this.navigateImage(1, viewer);
            });

            // Add click event to main image container to navigate to next image
            const imageContainer = viewer.querySelector('.image-viewer-main');
            imageContainer.addEventListener('click', (e) => {
                // Only trigger if clicking on the container but not the image itself
                if (e.target === imageContainer) {
                    this.navigateImage(1, viewer);
                }
            });

            // Add click event to the image itself to also navigate to next image
            const mainImage = viewer.querySelector('.image-viewer-main img');
            mainImage.addEventListener('click', (e) => {
                this.navigateImage(1, viewer);
                e.stopPropagation(); // Prevent the container's click from also firing
            });

            // Zoom controls
            const zoomInBtn = viewer.querySelector('.image-viewer-zoom-in');
            const zoomOutBtn = viewer.querySelector('.image-viewer-zoom-out');
            const resetBtn = viewer.querySelector('.image-viewer-reset');

            let currentZoom = 1;

            zoomInBtn.addEventListener('click', () => {
                currentZoom = Math.min(currentZoom + 0.25, 3);
                mainImage.style.transform = `scale(${currentZoom})`;
            });

            zoomOutBtn.addEventListener('click', () => {
                currentZoom = Math.max(currentZoom - 0.25, 0.5);
                mainImage.style.transform = `scale(${currentZoom})`;
            });

            resetBtn.addEventListener('click', () => {
                currentZoom = 1;
                mainImage.style.transform = 'scale(1)';
            });

            // Keyboard navigation
            viewer.addEventListener('keydown', (e) => {
                switch (e.key) {
                    case 'ArrowLeft':
                        this.navigateImage(-1, viewer);
                        e.preventDefault();
                        break;
                    case 'ArrowRight':
                        this.navigateImage(1, viewer);
                        e.preventDefault();
                        break;
                    case 'Escape':
                        viewer.close();
                        e.preventDefault();
                        break;
                    case '+':
                        zoomInBtn.click();
                        e.preventDefault();
                        break;
                    case '-':
                        zoomOutBtn.click();
                        e.preventDefault();
                        break;
                    case '0':
                        resetBtn.click();
                        e.preventDefault();
                        break;
                }
            });

            // Close on backdrop click
            viewer.addEventListener('click', (e) => {
                if (e.target === viewer) {
                    viewer.close();
                }
            });

            // Reset zoom when navigating or closing
            const resetZoom = () => {
                currentZoom = 1;
                mainImage.style.transform = 'scale(1)';
            };

            prevBtn.addEventListener('click', resetZoom);
            nextBtn.addEventListener('click', resetZoom);
            closeBtn.addEventListener('click', resetZoom);

            // Add the viewer to the page
            document.body.appendChild(viewer);
        }

        return viewer;
    }

    navigateImage(direction, viewer) {
        const galleryId = viewer.dataset.currentGallery;
        let currentIndex = parseInt(viewer.dataset.currentIndex, 10);
        const totalImages = parseInt(viewer.dataset.totalImages, 10);

        // Calculate the new index with wrap-around
        currentIndex = (currentIndex + direction + totalImages) % totalImages;

        // Get the images from the gallery
        const gallery = document.getElementById(galleryId);
        const images = JSON.parse(gallery.dataset.images);

        // Update the viewer
        viewer.dataset.currentIndex = currentIndex;

        // Update the main image
        const mainImage = viewer.querySelector('.image-viewer-main img');
        mainImage.src = images[currentIndex];
        mainImage.alt = `Image ${currentIndex + 1} of ${totalImages}`;

        // Update counter
        const counter = viewer.querySelector('.image-viewer-counter');
        counter.textContent = `${currentIndex + 1} / ${totalImages}`;
    }
}

// 更简洁的初始化方式
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initExtension);
} else {
    initExtension();
}

function initExtension() {
    const picPeek = new GitHubRepoPicPeek();
    picPeek.init();
} 