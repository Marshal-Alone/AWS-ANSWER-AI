document.addEventListener('DOMContentLoaded', () => {
    const autoModeToggle = document.getElementById('autoMode');
    const manualTriggerBtn = document.getElementById('manualTrigger');
    const statusText = document.getElementById('statusText');
    const questionText = document.getElementById('questionText');
    const aiAnswer = document.getElementById('aiAnswer');
    const intervalInput = document.getElementById('intervalInput');
    const intervalSetting = document.getElementById('intervalSetting');
    const autoClickMode = document.getElementById('autoClickMode');
    const aiProviderSelect = document.getElementById('aiProvider');

    // Initialization elements
    const initializeBtn = document.getElementById('initializeBtn');
    const configStatus = document.getElementById('configStatus');
    const configHostname = document.getElementById('configHostname');
    const resetConfigBtn = document.getElementById('resetConfigBtn');

    // Check for existing strategy on load
    checkForStrategy();

    // Initialize Inspector button
    initializeBtn.addEventListener('click', () => {
        statusText.textContent = '🔍 Inspector mode activated. Click on a quiz container...';
        statusText.style.color = '#f59e0b';

        sendMessageToContentScript({ action: 'TOGGLE_INSPECTOR', value: true });
    });

    // Reset Configuration button
    resetConfigBtn.addEventListener('click', async () => {
        const hostname = await getCurrentHostname();
        const strategyKey = `quiz_strategy_${hostname}`;

        chrome.storage.local.remove(strategyKey, () => {
            configStatus.style.display = 'none';
            statusText.textContent = `Configuration reset. Click Initialize to set up again.`;
            statusText.style.color = '#666';
        });
    });

    // Check if strategy exists for current hostname
    async function checkForStrategy() {
        const hostname = await getCurrentHostname();
        const strategyKey = `quiz_strategy_${hostname}`;

        chrome.storage.local.get([strategyKey], (result) => {
            if (result[strategyKey]) {
                configStatus.style.display = 'flex';
                configHostname.textContent = `Configured for ${hostname}`;
                statusText.textContent = `✅ Ready`;
                statusText.style.color = '#10b981';
            } else {
                configStatus.style.display = 'none';
            }
        });
    }

    // Get current tab hostname
    async function getCurrentHostname() {
        return new Promise((resolve) => {
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                if (!tabs[0]) {
                    resolve('unknown');
                    return;
                }

                try {
                    const url = new URL(tabs[0].url);
                    if (url.protocol === 'file:') {
                        const filename = url.pathname.split('/').pop().replace('.html', '');
                        resolve(`local_${filename}`);
                    } else {
                        resolve(url.hostname);
                    }
                } catch (error) {
                    resolve('unknown');
                }
            });
        });
    }

    // Load saved settings
    chrome.storage.local.get(['autoMode', 'checkInterval', 'autoClickEnabled', 'aiProvider'], (result) => {
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
        if (result.aiProvider) {
            aiProviderSelect.value = result.aiProvider;
        }
    });

    // Save AI provider selection
    aiProviderSelect.addEventListener('change', () => {
        const provider = aiProviderSelect.value;
        chrome.storage.local.set({ aiProvider: provider });
        statusText.textContent = `Switched to ${aiProviderSelect.options[aiProviderSelect.selectedIndex].text}`;
        statusText.style.color = '#667eea';
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
        statusText.textContent = isAuto ? `Auto Mode Enabled (every ${interval}s)` : 'Auto Mode Disabled';
    });

    // Manual Trigger
    manualTriggerBtn.addEventListener('click', () => {
        statusText.textContent = 'Extracting...';
        sendMessageToContentScript({ action: 'EXTRACT_AND_SOLVE' });
    });

    // Listen for messages from background script
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === 'UPDATE_STATUS') {
            statusText.textContent = request.message;
            statusText.style.color = '#666';
        } else if (request.action === 'SHOW_RESULT') {
            displayResult(request.data);
        } else if (request.action === 'CODING_SOLUTION') {
            // Display coding question result
            displayCodingResult(request);
        } else if (request.action === 'ERROR') {
            statusText.textContent = 'Error: ' + request.message;
            statusText.style.color = 'red';
        } else if (request.action === 'STRATEGY_SAVED') {
            configStatus.style.display = 'flex';
            configHostname.textContent = `Configured for ${request.hostname}`;

            // Show validation details if available
            if (request.validation && request.validation.success) {
                statusText.textContent = `✅ Strategy saved! (Q: ✓, Options: ${request.validation.optionsCount}/4)`;
            } else {
                statusText.textContent = `✅ Strategy saved!`;
            }
            statusText.style.color = '#10b981';
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
                statusText.innerHTML = '⚠️ Please <strong>refresh</strong> this page:<br>Press <kbd>Ctrl+Shift+R</kbd> or <kbd>Cmd+Shift+R</kbd>';
                statusText.style.color = '#ff6b6b';
                statusText.style.fontSize = '13px';
            });
        });
    }

    function displayResult(data) {
        questionText.textContent = data.question;
        aiAnswer.textContent = data.answer || 'Waiting for AI...';
        statusText.textContent = `Solved! (${data.model})`;
        statusText.style.color = '#333';
    }
    
    function displayCodingResult(data) {
        questionText.textContent = data.question;
        aiAnswer.textContent = `[${data.language.toUpperCase()}]\\n${data.code}`;
        statusText.textContent = ' Code Generated!';
        statusText.style.color = '#10b981';
    }
});
