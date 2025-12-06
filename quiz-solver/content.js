// ============================================
// STATE MANAGEMENT
// ============================================
let autoModeInterval = null;
let lastSolvedQuestion = '';
let isInspecting = false;
let lastHighlightedElement = null;
let automationRunning = false;

// ============================================
// MESSAGE HANDLERS
// ============================================
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'EXTRACT_AND_SOLVE') {
        extractAndSolve();
    } else if (request.action === 'TOGGLE_AUTO_MODE') {
        if (request.value) {
            if (request.interval) {
                chrome.storage.local.set({ checkInterval: request.interval });
            }
            startAutoMode();
        } else {
            stopAutoMode();
        }
    } else if (request.action === 'HIGHLIGHT_ANSWER') {
        const answers = Array.isArray(request.answers) ? request.answers : [request.answer];
        window.__selectedAnswers = answers;
        highlightAnswers(answers);
    } else if (request.action === 'TOGGLE_INSPECTOR') {
        toggleInspector(request.value);
    } else if (request.action === 'START_AUTOMATION') {
        startStrategyBasedAutomation();
    } else if (request.action === 'STOP_AUTOMATION') {
        stopStrategyBasedAutomation();
    }
});

function startAutoMode() {
    if (autoModeInterval) clearInterval(autoModeInterval);

    chrome.storage.local.get(['checkInterval'], (result) => {
        const intervalSeconds = (result.checkInterval || 5) * 1000;
        autoModeInterval = setInterval(() => {
            extractAndSolve(true);
        }, intervalSeconds);
    });
}

function stopAutoMode() {
    if (autoModeInterval) clearInterval(autoModeInterval);
    autoModeInterval = null;
}

function extractAndSolve(isAuto = false, retryCount = 0) {
    const data = extractQuizData();

    if (!data) {
        if (retryCount < 3) {
            const delay = (retryCount + 1) * 500;
            console.log(`No quiz found, retrying in ${delay}ms... (attempt ${retryCount + 1}/3)`);
            setTimeout(() => {
                extractAndSolve(isAuto, retryCount + 1);
            }, delay);
            return;
        }

        if (!isAuto) {
            chrome.runtime.sendMessage({ action: 'ERROR', message: 'No quiz found on page.' });
        }
        return;
    }

    if (!isAuto) {
        lastSolvedQuestion = data.question;
        window.__currentQuestionData = data;
        chrome.runtime.sendMessage({ action: 'SOLVE_QUIZ', data: data });
        return;
    }

    if (data.question !== lastSolvedQuestion) {
        lastSolvedQuestion = data.question;
        window.__currentQuestionData = data;
        chrome.runtime.sendMessage({ action: 'SOLVE_QUIZ', data: data });
    }
}

function extractQuizData() {
    console.log('=== Starting quiz extraction ===');

    // Check quiz mode from storage
    chrome.storage.local.get(['quizMode'], async (result) => {
        const quizMode = result.quizMode || 'AWS';

        // If CUSTOM mode, ONLY use AI strategy - don't fallback to old methods
        if (quizMode === 'CUSTOM') {
            console.log('🤖 CUSTOM mode - using AI-generated strategy only');
            const hostname = window.location.hostname;
            const strategyKey = `quiz_strategy_${hostname}`;

            const strategyData = await chrome.storage.local.get(strategyKey);
            if (!strategyData[strategyKey]) {
                console.error('❌ No strategy found for', hostname);
                console.log('=== Trying Google Quiz extraction ===');
                const googleQuizResult = extractFromGoogleQuiz();
                if (googleQuizResult) {
                    console.log('✓ Extracted using Google Quiz strategy');
                    return googleQuizResult;
                }

                // Try quiz card format (AWS Academy format with .quiz-item__card--active)
                console.log('=== Trying quiz card extraction ===');
                const quizCardResult = extractFromQuizCard();
                if (quizCardResult) {
                    console.log('✓ Extracted using quiz card strategy');
                    return quizCardResult;
                }

                const allRadios = document.querySelectorAll('input[type="radio"]');
                const allCheckboxes = document.querySelectorAll('input[type="checkbox"]');
                console.log('Total radio buttons found:', allRadios.length);
                console.log('Total checkboxes found:', allCheckboxes.length);

                const enabledRadios = Array.from(allRadios).filter(input => !input.disabled);
                const enabledCheckboxes = Array.from(allCheckboxes).filter(input => !input.disabled);
                const allInputs = [...enabledRadios, ...enabledCheckboxes];

                console.log('Enabled radio buttons:', enabledRadios.length);
                console.log('Enabled checkboxes:', enabledCheckboxes.length);
                console.log('Total enabled inputs:', allInputs.length);

                const hiddenLabels = Array.from(document.querySelectorAll('label[style*="display:none"]'));
                console.log('Hidden labels found:', hiddenLabels.length);

                if (hiddenLabels.length > 0) {
                    const result = extractFromHiddenLabels(hiddenLabels);
                    if (result) {
                        console.log('✓ Extracted using hidden labels strategy');
                        return result;
                    }
                }

                if (allInputs.length >= 2) {
                    const result = extractFromRadios(allInputs);
                    if (result) {
                        console.log('✓ Extracted using input elements strategy');
                        return result;
                    }
                }

                console.log('✗ No quiz data extracted');
                return null;
            }

            /**
             * Extract quiz data from Google Developer quiz format (MUI-based)
             * Handles the format with .MuiBox-root, .MuiTypography, and .MuiFormControlLabel
             */
            function extractFromGoogleQuiz() {
                console.log('=== Trying Google Quiz extraction ===');

                // Use the most stable top-level container class
                const quizWrapper = document.querySelector('.MuiBox-root.css-rb0ah3');

                if (!quizWrapper) {
                    console.log('Google Quiz wrapper not found');
                    return null;
                }

                // --- Extract Question Text ---
                const questionElement = quizWrapper.querySelector('h6.MuiTypography-h6');
                const questionText = questionElement
                    ? questionElement.textContent.trim()
                    : null;

                if (!questionText) {
                    console.log('Question not found in Google Quiz format');
                    return null;
                }

                // --- Extract Options (Optimized) ---
                const options = [];
                const optionData = [];

                // Find all <label> elements that act as the container for each radio option
                const optionLabels = quizWrapper.querySelectorAll('.MuiFormControlLabel-root');

                if (optionLabels.length < 2) {
                    console.log('Not enough options found in Google Quiz format');
                    return null;
                }

                optionLabels.forEach(label => {
                    // Find the input and the text relative to the current label
                    const radioInput = label.querySelector('input[type="radio"]');
                    const optionTextElement = label.querySelector('p.MuiTypography-body1');

                    // Ensure both elements exist before pushing
                    if (radioInput && optionTextElement) {
                        const optionText = optionTextElement.textContent.trim();
                        if (optionText) {
                            options.push(optionText);
                            optionData.push({ radio: radioInput, label: label });
                        }
                    }
                });

                // --- Get Next Button ---
                // Look for the <button> element with the text "NEXT"
                const nextButton = Array.from(quizWrapper.querySelectorAll('button')).find(
                    btn => btn.textContent.trim() === 'NEXT'
                );

                if (questionText && options.length >= 2) {
                    window.__quizOptions = optionData;
                    window.__googleQuizNextButton = nextButton;
                    console.log(`Google Quiz extracted: ${options.length} options, Next button: ${nextButton ? 'Found' : 'Not found'}`);
                    return { question: questionText, options: options };
                }

                return null;
            }

            function extractFromQuizCard() {
                console.log('=== Trying quiz card extraction ===');

                // Target only the ACTIVE question card
                let quizCard = document.querySelector('.quiz-item__card--active .quiz-card__main');
                if (!quizCard) quizCard = document.querySelector('.quiz-card__main');
                if (!quizCard) quizCard = document.querySelector('.quiz-card__row');
                if (!quizCard) return null;

                // Check for content
                if (!quizCard.querySelector('.quiz-card__title')) return null;

                // Extract Question
                let question = '';
                const questionElement = quizCard.querySelector('.quiz-card__title .fr-view p');
                if (questionElement) {
                    question = questionElement.textContent.trim();
                } else {
                    const questionContainer = quizCard.querySelector('.quiz-card__title .fr-view');
                    if (questionContainer) {
                        const pTag = questionContainer.querySelector('p');
                        question = pTag ? pTag.textContent.trim() : questionContainer.textContent.trim();
                    }
                }
                if (!question) return null;

                // Extract Options - Try Multiple Choice (Radio) first, then Multiple Response (Checkbox)
                let optionContainers = quizCard.querySelectorAll('div[data-test-id="quiz-card-option"]');
                let questionType = 'multiple-choice';

                if (optionContainers.length === 0) {
                    optionContainers = quizCard.querySelectorAll('ul li label.quiz-multiple-response-option');
                    questionType = 'multiple-response';
                }

                if (optionContainers.length < 2) return null;

                const options = [];
                const optionData = [];

                optionContainers.forEach((container, index) => {
                    let input, optionTextElement;

                    if (questionType === 'multiple-choice') {
                        input = container.querySelector('input[type="radio"]');
                        optionTextElement = container.querySelector('.quiz-multiple-choice-option__text .fr-view p') ||
                            container.querySelector('.quiz-multiple-choice-option__text .fr-view') ||
                            container.querySelector('.quiz-multiple-choice-option__text');
                    } else {
                        input = container.querySelector('input[type="checkbox"]');
                        optionTextElement = container.querySelector('.quiz-multiple-response-option__text .fr-view p') ||
                            container.querySelector('.quiz-multiple-response-option__text .fr-view') ||
                            container.querySelector('.quiz-multiple-response-option__text');
                    }

                    if (input && optionTextElement) {
                        const optionText = optionTextElement.textContent.trim();
                        if (optionText) {
                            options.push(optionText);
                            optionData.push({ radio: input, label: container });
                        }
                    }
                });

                if (question && options.length >= 2) {
                    window.__quizOptions = optionData;
                    return { question, options };
                }
                return null;
            }

            function extractFromHiddenLabels(labels) {
                let question = '';
                const options = [];
                const optionElements = [];

                const allText = document.body.innerText;
                const lines = allText.split('\n').map(l => l.trim()).filter(l => l.length > 0);

                for (const line of lines) {
                    if (line.includes('?') && line.length > 20 && line.length < 500) {
                        question = line;
                        break;
                    }
                }

                labels.forEach(label => {
                    const labelId = label.id;
                    const text = label.textContent.trim();

                    if (text === question || text.length < 10) return;

                    const radioId = labelId.replace('_label', '');
                    const radio = document.getElementById(`acc-${radioId}`) || document.querySelector(`input[aria-labelledby="${labelId}"]`);

                    if (radio && text.length > 10) {
                        options.push(text);
                        optionElements.push({ radio, label });
                    }
                });

                if (question && options.length >= 2) {
                    window.__quizOptions = optionElements;
                    return { question, options };
                }

                return null;
            }

            function extractFromRadios(inputElements) {
                console.log('Extracting from', inputElements.length, 'input elements');

                let question = findQuestionText();

                if (!question) {
                    question = document.querySelector('h1, h2, h3')?.textContent.trim() || 'Question';
                }

                console.log('Question found:', question);

                const options = [];
                const optionElements = [];

                inputElements.forEach((input, index) => {
                    if (input.disabled) {
                        console.log(`Skipping disabled input ${index}`);
                        return;
                    }

                    let optionText = '';
                    let optionElement = null;

                    const labelId = input.getAttribute('aria-labelledby');
                    if (labelId) {
                        const label = document.getElementById(labelId);
                        if (label) {
                            optionText = label.textContent.trim();
                            optionElement = { radio: input, label };
                        }
                    }

                    if (!optionText) {
                        const label = document.querySelector(`label[for="${input.id}"]`) || input.closest('label');
                        if (label) {
                            optionText = label.textContent.trim();
                            optionElement = { radio: input, label };
                        }
                    }

                    if (!optionText || optionText.length < 5) {
                        const parent = input.parentElement;
                        if (parent) {
                            optionText = parent.textContent.trim();
                            optionElement = { radio: input, label: parent };
                        }
                    }

                    optionText = cleanOptionText(optionText, question);

                    if (optionText && optionText.length > 3 && !options.includes(optionText)) {
                        console.log(`Option ${options.length + 1}:`, optionText);
                        options.push(optionText);
                        optionElements.push(optionElement);
                    }
                });

                console.log('Total options extracted:', options.length);

                if (options.length >= 2) {
                    window.__quizOptions = optionElements;
                    return { question, options };
                }

                return null;
            }

            function findQuestionText() {
                const allText = document.body.innerText;
                const lines = allText.split('\n').map(l => l.trim()).filter(l => l.length > 0);

                for (const line of lines) {
                    if (line.includes('?') && line.length > 20 && line.length < 500) {
                        return line;
                    }
                }

                return null;
            }

            function cleanOptionText(text, question) {
                if (text.includes(question)) {
                    text = text.replace(question, '').trim();
                }

                text = text.replace(/^[○●◯◉⚪⚫]\s*/, '');
                text = text.replace(/^[A-D][\.\\)]\s*/, '');
                text = text.replace(/^\d+[\.\\)]\s*/, '');

                return text.trim();
            }

            function highlightAnswers(answersArray) {
                console.log('🤖 AI Answers:', answersArray);

                const answerParts = [];
                for (const answer of answersArray) {
                    const parts = answer
                        .split(/\s*\|\s*|[;\n]|(?:\s+and\s+)/i)
                        .map(part => part.toLowerCase().trim())
                        .filter(part => part.length > 3);
                    answerParts.push(...parts);
                }

                console.log('📋 Answer parts to match:', answerParts);

                if (window.__quizOptions) {
                    let autoClickTriggered = false;

                    window.__quizOptions.forEach(({ radio, label }) => {
                        const text = label.textContent.toLowerCase().trim();

                        // Calculate match score - how many answer parts are in this option
                        let matchCount = 0;
                        let totalParts = answerParts.length;

                        answerParts.forEach(answerPart => {
                            if (text.includes(answerPart)) {
                                matchCount++;
                            }
                        });

                        // Require at least 50% of answer parts to match (or all parts if only 1-2 parts)
                        const requiredMatches = totalParts <= 2 ? totalParts : Math.ceil(totalParts * 0.5);
                        const isMatch = matchCount >= requiredMatches;

                        console.log(`Checking "${text.substring(0, 50)}..." - Matched ${matchCount}/${totalParts} parts (need ${requiredMatches})`);

                        if (isMatch) {
                            console.log('✓ Matched option:', text);

                            if (radio && !radio.checked) {
                                console.log('  → Ticking checkbox');
                                radio.checked = true;
                                radio.dispatchEvent(new Event('input', { bubbles: true }));
                                radio.dispatchEvent(new Event('change', { bubbles: true }));
                                radio.click();
                            } else if (radio) {
                                console.log('  → Already ticked');
                            }

                            // Style the correct answer
                            let visibleParent = radio.parentElement;
                            while (visibleParent && window.getComputedStyle(visibleParent).display === 'none') {
                                visibleParent = visibleParent.parentElement;
                            }

                            if (visibleParent) {
                                visibleParent.style.border = '4px solid #2ecc71';
                                visibleParent.style.backgroundColor = '#e8f8f5';
                                visibleParent.style.borderRadius = '8px';
                                visibleParent.style.boxShadow = '0 0 15px rgba(46, 204, 113, 0.5)';
                            }

                            if (!autoClickTriggered) {
                                autoClickTriggered = true;
                                chrome.storage.local.get(['autoClickEnabled'], (result) => {
                                    if (result.autoClickEnabled !== false) {
                                        setTimeout(() => autoClickButtons(), 1000);
                                    }
                                });
                            }
                        } else {
                            // Reset styling for non-matches
                            let visibleParent = radio.parentElement;
                            while (visibleParent && window.getComputedStyle(visibleParent).display === 'none') {
                                visibleParent = visibleParent.parentElement;
                            }

                            if (visibleParent) {
                                visibleParent.style.border = '';
                                visibleParent.style.backgroundColor = '';
                                visibleParent.style.boxShadow = '';
                            }
                        }
                    });
                    return;
                }

                // Fallback for non-standard quiz formats
                const allElements = Array.from(document.querySelectorAll('div, p, span, label'));
                allElements.forEach(el => {
                    const text = el.textContent.toLowerCase().trim();
                    const isMatch = answerParts.some(answerPart =>
                        text.includes(answerPart) && text.length < 500 && text.length > 10
                    );

                    if (isMatch) {
                        el.style.border = '3px solid #2ecc71';
                        el.style.backgroundColor = '#e8f8f5';
                        el.style.borderRadius = '5px';
                    }
                });

                chrome.storage.local.get(['autoClickEnabled'], (result) => {
                    if (result.autoClickEnabled !== false) {
                        setTimeout(() => autoClickButtons(), 1000);
                    }
                });
            }

            function autoClickButtons() {
                // Check for Google Quiz NEXT button first
                if (window.__googleQuizNextButton && !window.__googleQuizNextButton.disabled) {
                    console.log('Found Google Quiz NEXT button, clicking...');
                    window.__googleQuizNextButton.click();
                    return;
                }

                const submitButton = findButtonByText(['Submit', 'Check Answer', 'OK']);

                if (submitButton) {
                    console.log('Found Submit button, clicking...');
                    submitButton.click();

                    setTimeout(() => {
                        findAndClickContinue();
                    }, 1500);
                } else {
                    console.log('Submit button not found');
                }
            }

            function findButtonByText(texts) {
                const allButtons = Array.from(document.querySelectorAll('button, [data-acc-text], [role="button"], .slide-object'));

                for (const text of texts) {
                    const button = allButtons.find(btn => {
                        const btnText = btn.textContent?.toLowerCase().trim() || '';
                        const accText = btn.getAttribute('data-acc-text')?.toLowerCase().trim() || '';
                        return btnText === text.toLowerCase() || accText === text.toLowerCase();
                    });

                    if (button) {
                        return button;
                    }
                }

                return null;
            }

            function findAndClickContinue() {
                const continueButton = findButtonByText(['Continue', 'Next', 'OK', 'Proceed']);

                if (continueButton) {
                    console.log('Found Continue button, clicking...');
                    continueButton.click();
                } else {
                    console.log('Continue button not found, trying again...');
                    setTimeout(() => {
                        const retryButton = findButtonByText(['Continue', 'Next', 'OK', 'Proceed']);
                        if (retryButton) {
                            retryButton.click();
                        }
                    }, 1000);
                }
            }

            // ============================================
            // INSPECTOR TOOL FUNCTIONS
            // ============================================

            /**
             * Toggle the inspector mode on/off
             */
            function toggleInspector(active) {
                isInspecting = active;
                if (active) {
                    document.body.classList.add('groq-cursor-mode');
                    document.addEventListener('mouseover', handleHover, true);
                    document.addEventListener('click', handleClick, true);
                    console.log('🔍 Inspector mode activated');
                } else {
                    document.body.classList.remove('groq-cursor-mode');
                    document.removeEventListener('mouseover', handleHover, true);
                    document.removeEventListener('click', handleClick, true);
                    removeHighlight();
                    console.log('🔍 Inspector mode deactivated');
                }
            }

            /**
             * Find the best container element by traversing up the DOM tree
             * Looks for semantic containers or elements with quiz-related classes/IDs
             */
            function findBestContainer(element) {
                let current = element;
                let depth = 0;
                const maxDepth = 4; // Look 4 levels up to be safe

                // Climb up the DOM tree
                while (current && current.parentElement && current.tagName !== 'BODY' && depth < maxDepth) {

                    // 1. If we hit a clear "Container" tag, we prefer this
                    if (['SECTION', 'ARTICLE', 'LI', 'FORM', 'MAIN'].includes(current.tagName)) {
                        return current;
                    }

                    // 2. If we hit an element with ID or Class that looks like a container
                    const idAndClass = (current.id + " " + current.className).toLowerCase();
                    if (idAndClass.includes('question') ||
                        idAndClass.includes('quiz') ||
                        idAndClass.includes('container') ||
                        idAndClass.includes('card') ||
                        idAndClass.includes('wrapper') ||
                        idAndClass.includes('item')) {
                        return current;
                    }

                    // Keep climbing
                    current = current.parentElement;
                    depth++;
                }

                // If we didn't find a "perfect" container, default to the highest level we reached
                return current;
            }

            /**
             * Clean HTML by removing unnecessary elements to save AI tokens
             */
            function cleanHTML(element) {
                const clone = element.cloneNode(true);

                // Remove scripts, styles, SVGs, and other non-essential elements
                const trash = clone.querySelectorAll('script, style, svg, path, noscript, iframe');
                trash.forEach(el => el.remove());

                // Remove inline styles to reduce noise
                const allElements = clone.querySelectorAll('*');
                allElements.forEach(el => {
                    el.removeAttribute('style');
                });

                return clone.outerHTML;
            }

            /**
             * Handle hover event during inspection
             */
            function handleHover(event) {
                if (!isInspecting) return;
                event.stopPropagation();
                removeHighlight();

                // Highlight the smart container, not just the hovered element
                const target = event.target;
                const container = findBestContainer(target);

                container.classList.add('groq-inspector-active');
                lastHighlightedElement = container;
            }

            /**
             * Handle click event during inspection - captures HTML and sends to AI
             */
            function handleClick(event) {
                if (!isInspecting) return;
                event.preventDefault();
                event.stopPropagation();

                const target = event.target;

                // 1. Capture the Smart Container
                const container = findBestContainer(target);

                // 2. Capture HTML and hostname
                const capturedHTML = cleanHTML(container);
                const hostname = window.location.hostname;

                toggleInspector(false);

                // 3. Visual feedback - flash green
                container.classList.add('groq-captured');
                setTimeout(() => {
                    container.classList.remove('groq-captured');
                }, 500);

                // 4. Send to Background for AI analysis
                console.log('📦 Captured Container:', container);
                console.log('🌐 Hostname:', hostname);
                chrome.runtime.sendMessage({
                    action: "ANALYZE_HTML",
                    html: capturedHTML,
                    hostname: hostname
                });
            }

            /**
             * Remove highlight from previously highlighted element
             */
            function removeHighlight() {
                if (lastHighlightedElement) {
                    lastHighlightedElement.classList.remove('groq-inspector-active');
                    lastHighlightedElement = null;
                }
            }

            // ============================================
            // STRATEGY-BASED AUTOMATION FUNCTIONS
            // ============================================

            /**
             * Start automation using AI-generated strategy
             */
            async function startStrategyBasedAutomation() {
                if (automationRunning) return;
                automationRunning = true;
                console.log('🤖 Starting strategy-based automation...');

                runAutomationLoop();
            }

            /**
             * Stop automation
             */
            function stopStrategyBasedAutomation() {
                automationRunning = false;
                console.log('🛑 Automation stopped');
            }

            /**
             * Main automation loop using AI-generated strategy
             */
            async function runAutomationLoop() {
                if (!automationRunning) return;

                // 1. Get the hostname-specific strategy
                const hostname = window.location.hostname;
                const strategyKey = `quiz_strategy_${hostname}`;

                const data = await chrome.storage.local.get(strategyKey);
                const config = data[strategyKey];

                if (!config) {
                    console.warn('⚠️ No strategy found for', hostname);
                    console.log('Please initialize the inspector first!');
                    automationRunning = false;
                    return;
                }

                console.log('📋 Using strategy:', config);

                // 2. Extract Question using strategy
                const qElement = document.querySelector(config.question_selector);
                if (!qElement) {
                    console.log('No question found, retrying...');
                    setTimeout(runAutomationLoop, 2000);
                    return;
                }

                const questionText = qElement.innerText;

                // 3. Extract Options using strategy
                const optionsElements = document.querySelectorAll(config.options_selector);
                if (optionsElements.length < 2) {
                    console.log('Not enough options found, retrying...');
                    setTimeout(runAutomationLoop, 2000);
                    return;
                }

                const optionsText = Array.from(optionsElements).map(el => el.innerText);

                console.log('📝 Question:', questionText);
                console.log('📋 Options:', optionsText);

                // 4. Ask AI for the Answer
                const answer = await fetchAnswerFromAI(questionText, optionsText);

                // 5. Click the Answer
                for (let el of optionsElements) {
                    if (el.innerText.includes(answer)) {
                        const input = el.querySelector('input') || el;
                        input.click();
                        console.log('✅ Clicked answer:', answer);
                        break;
                    }
                }

                // 6. Click Next/Submit button
                setTimeout(() => {
                    let nextBtn = null;

                    // Try strategy selector first
                    if (config.submit_next_selector && config.submit_next_selector !== 'null') {
                        nextBtn = document.querySelector(config.submit_next_selector);
                    }

                    // Fallback to generic button detection
                    if (!nextBtn) {
                        nextBtn = findButtonByText(['Next', 'NEXT', 'Submit', 'Continue', 'OK']);
                    }

                    if (nextBtn && !nextBtn.disabled) {
                        console.log('⏭️ Clicking Next button');
                        nextBtn.click();

                        // Continue loop after DOM updates
                        setTimeout(runAutomationLoop, 2000);
                    } else {
                        console.log('⚠️ Next button not found or disabled');
                        automationRunning = false;
                    }
                }, 1000);
            }

            /**
             * Fetch answer from AI (placeholder - will be handled by background script)
             */
            async function fetchAnswerFromAI(question, options) {
                // This is a placeholder - the actual AI call happens in background.js
                // For now, return the first option as a fallback
                return options[0];
            }
