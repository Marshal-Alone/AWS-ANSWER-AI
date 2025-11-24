document.addEventListener('DOMContentLoaded', () => {
    const autoModeToggle = document.getElementById('autoMode');
    const manualTriggerBtn = document.getElementById('manualTrigger');
    const statusText = document.getElementById('statusText');
    const resultsArea = document.getElementById('resultsArea');
    const questionText = document.getElementById('questionText');
    const optionsList = document.getElementById('optionsList');
    const aiAnswer = document.getElementById('aiAnswer');
    const intervalInput = document.getElementById('intervalInput');
    const intervalSetting = document.getElementById('intervalSetting');
    const autoClickMode = document.getElementById('autoClickMode');
    const confidenceBadge = document.getElementById('confidenceBadge');
    const modelInfo = document.getElementById('modelInfo');

    // Load saved settings
    chrome.storage.local.get(['autoMode', 'checkInterval', 'autoClickEnabled'], (result) => {
        if (result.autoMode) {
            autoModeToggle.checked = result.autoMode;
            intervalSetting.classList.add('active');
        }
        if (result.checkInterval) {
            intervalInput.value = result.checkInterval;
        }
        if (result.autoClickEnabled !== undefined) {
            autoClickMode.checked = result.autoClickEnabled;
        }
    });

    // Save auto-click preference
    autoClickMode.addEventListener('change', () => {
        chrome.storage.local.set({ autoClickEnabled: autoClickMode.checked });
    });

    // Save interval when changed
    intervalInput.addEventListener('change', () => {
        const interval = parseInt(intervalInput.value) || 5;
        chrome.storage.local.set({ checkInterval: interval });

        if (autoModeToggle.checked) {
            sendMessageToContentScript({ action: 'TOGGLE_AUTO_MODE', value: false });
            setTimeout(() => {
                sendMessageToContentScript({ action: 'TOGGLE_AUTO_MODE', value: true, interval: interval });
            }, 100);
        }
    });

    // Toggle Auto Mode
    autoModeToggle.addEventListener('change', () => {
        const isAuto = autoModeToggle.checked;
        const interval = parseInt(intervalInput.value) || 5;

        chrome.storage.local.set({ autoMode: isAuto, checkInterval: interval });

        if (isAuto) {
            intervalSetting.classList.add('active');
        } else {
            intervalSetting.classList.remove('active');
        }

        sendMessageToContentScript({ action: 'TOGGLE_AUTO_MODE', value: isAuto, interval: interval });
        statusText.textContent = isAuto ? `Auto Mode Enabled (checking every ${interval}s)` : 'Auto Mode Disabled';
    });

    // Manual Trigger
    manualTriggerBtn.addEventListener('click', () => {
        statusText.textContent = 'Extracting...';
        sendMessageToContentScript({ action: 'EXTRACT_AND_SOLVE' });
    });

    // Listen for messages from content script
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === 'UPDATE_STATUS') {
            statusText.textContent = request.message;
        } else if (request.action === 'SHOW_RESULT') {
            displayResult(request.data);
        } else if (request.action === 'ERROR') {
            statusText.textContent = 'Error: ' + request.message;
            statusText.style.color = 'red';
        }
    });

    function sendMessageToContentScript(message) {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (!tabs[0]) {
                statusText.textContent = 'Error: No active tab found.';
                statusText.style.color = 'red';
                return;
            }

            chrome.tabs.sendMessage(tabs[0].id, message).catch(err => {
                statusText.innerHTML = '⚠️ Please <strong>hard refresh</strong> this page:<br>Press <kbd>Ctrl+Shift+R</kbd> (Windows/Linux)<br>or <kbd>Cmd+Shift+R</kbd> (Mac)';
                statusText.style.color = '#ff6b6b';
                statusText.style.fontSize = '13px';
                console.error('Content script not loaded:', err);
            });
        });
    }

    function displayResult(data) {
        resultsArea.style.display = 'block';
        questionText.textContent = data.question;

        // Only update options list if element exists (may be commented out)
        if (optionsList) {
            optionsList.innerHTML = '';
            data.options.forEach((opt, index) => {
                const li = document.createElement('li');
                li.textContent = opt;
                optionsList.appendChild(li);
            });
        }

        aiAnswer.textContent = data.answer || 'Waiting for AI...';

        // Display confidence (only if element exists)
        if (data.confidence && confidenceBadge) {
            const conf = parseFloat(data.confidence);
            confidenceBadge.textContent = `${Math.round(conf * 100)}% confident`;
            confidenceBadge.className = 'confidence-badge';

            if (conf >= 0.8) {
                confidenceBadge.classList.add('confidence-high');
            } else if (conf >= 0.5) {
                confidenceBadge.classList.add('confidence-medium');
            } else {
                confidenceBadge.classList.add('confidence-low');
            }
        }

        // Display model info (only if element exists)
        if (data.model && modelInfo) {
            modelInfo.textContent = `Model: ${data.model}`;
        }

        statusText.textContent = `Solved! Found ${data.options.length} options.`;
        statusText.style.color = '#333';
    }
});
