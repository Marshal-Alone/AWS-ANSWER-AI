// ============================================
// STATE MANAGEMENT
// ============================================
let autoModeInterval = null;
let lastSolvedQuestion = '';
let isInspecting = false;
let lastHighlightedElement = null;
let capturedElement = null; // Track captured element for cleanup
let highlightedOptions = []; // Track highlighted answer options

// ============================================
// MESSAGE HANDLERS
// ============================================
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'EXTRACT_AND_SOLVE') {
        extractAndSolve();
    } else if (request.action === 'TOGGLE_AUTO_MODE') {
        if (request.value) {
            startAutoMode(request.interval);
        } else {
            stopAutoMode();
        }
    } else if (request.action === 'HIGHLIGHT_ANSWER') {
        const answers = Array.isArray(request.answers) ? request.answers : [request.answer];
        highlightAnswers(answers);
    } else if (request.action === 'TOGGLE_INSPECTOR') {
        toggleInspector(request.value);
    } else if (request.action === 'VALIDATE_SELECTORS') {
        // Validate selectors on the page
        const result = validateSelectors(request.selectors);
        sendResponse(result);
        return true; // Keep channel open for async response
    }
});

// ============================================
// AUTO MODE
// ============================================
function startAutoMode(intervalSeconds = 5) {
    if (autoModeInterval) clearInterval(autoModeInterval);

    autoModeInterval = setInterval(() => {
        extractAndSolve(true);
    }, intervalSeconds * 1000);
}

function stopAutoMode() {
    if (autoModeInterval) clearInterval(autoModeInterval);
    autoModeInterval = null;
}

// ============================================
// SELECTOR VALIDATION
// ============================================
function validateSelectors(selectors) {
    console.log('🔍 Validating selectors:', selectors);

    try {
        // Test question selector
        const questionElement = document.querySelector(selectors.question_selector);
        const questionFound = !!questionElement;

        // Test options selector
        const optionElements = document.querySelectorAll(selectors.options_selector);
        const optionsCount = optionElements.length;

        console.log(`Question found: ${questionFound}`);
        console.log(`Options found: ${optionsCount}`);

        // Validation criteria: question exists and exactly 4 options found
        const success = questionFound && optionsCount === 4;

        let error = '';
        if (!questionFound) {
            error = 'Question selector did not find any element';
        } else if (optionsCount !== 4) {
            error = `Options selector found ${optionsCount} elements instead of 4`;
        }

        return {
            success: success,
            questionFound: questionFound,
            optionsCount: optionsCount,
            error: error,
            questionText: questionFound ? questionElement.innerText.substring(0, 100) : '',
            optionTexts: Array.from(optionElements).slice(0, 4).map(el => el.innerText.substring(0, 50))
        };

    } catch (error) {
        console.error('❌ Validation error:', error);
        return {
            success: false,
            questionFound: false,
            optionsCount: 0,
            error: error.message
        };
    }
}

// ============================================
// QUIZ EXTRACTION (ASYNC)
// ============================================
async function extractAndSolve(isAuto = false, retryCount = 0) {
    const data = await extractQuizData();

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
        chrome.runtime.sendMessage({ action: 'SOLVE_QUIZ', data: data });
        return;
    }

    if (data.question !== lastSolvedQuestion) {
        lastSolvedQuestion = data.question;
        chrome.runtime.sendMessage({ action: 'SOLVE_QUIZ', data: data });
    }
}

async function extractQuizData() {
    console.log('=== Starting AI strategy-based extraction ===');

    // Get hostname for strategy lookup
    const hostname = window.location.hostname || 'local_' + window.location.pathname.split('/').pop().replace('.html', '');
    const strategyKey = `quiz_strategy_${hostname}`;

    // Get strategy from storage
    const result = await chrome.storage.local.get(strategyKey);
    const strategy = result[strategyKey];

    if (!strategy) {
        console.error('❌ No strategy found for', hostname);
        chrome.runtime.sendMessage({
            action: 'ERROR',
            message: `No configuration found. Please click "Initialize Inspector" first.`
        });
        return null;
    }

    console.log('📋 Using strategy:', strategy);

    try {
        // Extract question using AI selector
        const questionElement = document.querySelector(strategy.question_selector);
        if (!questionElement) {
            console.error('❌ Question not found with selector:', strategy.question_selector);
            return null;
        }
        const question = questionElement.innerText.trim();
        console.log('✓ Question extracted:', question);

        // Extract options using AI selector
        const optionElements = document.querySelectorAll(strategy.options_selector);
        if (!optionElements || optionElements.length < 2) {
            console.error('❌ Options not found with selector:', strategy.options_selector);
            console.error('   Found', optionElements?.length || 0, 'elements');
            return null;
        }

        const options = Array.from(optionElements).map(el => el.innerText.trim());
        console.log('✓ Options extracted:', options);

        // Store option elements for later clicking
        const optionData = Array.from(optionElements).map(el => {
            // Find the input element (radio/checkbox)
            const input = el.querySelector('input') || el;
            return { radio: input, label: el };
        });
        window.__quizOptions = optionData;

        console.log('✅ Strategy-based extraction successful!');
        return { question, options };

    } catch (error) {
        console.error('❌ Strategy extraction error:', error);
        chrome.runtime.sendMessage({
            action: 'ERROR',
            message: `Extraction failed: ${error.message}`
        });
        return null;
    }
}

// ============================================
// ANSWER HIGHLIGHTING (IMPROVED MATCHING)
// ============================================
function highlightAnswers(answersArray) {
    // Clear previous highlights first
    clearAnswerHighlights();
    console.log('🤖 AI Answers:', answersArray);

    const answerParts = [];
    for (const answer of answersArray) {
        const parts = answer
            .split(/\s*\|\s*|[;\n]|(?:\s+and\s+)/i)
            .map(part => part.toLowerCase().replace(/\s+/g, ' ').trim()) // Normalize whitespace
            .filter(part => part.length > 0);
        answerParts.push(...parts);
    }

    console.log('📋 Answer parts to match:', answerParts);

    if (!window.__quizOptions) {
        console.error('❌ No quiz options found');
        return;
    }

    let autoClickTriggered = false;

    const potentialMatches = [];
    const isSingleLetter = answerParts.length === 1 && answerParts[0].length === 1;
    let totalParts = answerParts.length;

    window.__quizOptions.forEach(({ radio, label }) => {
        // Normalize text: remove newlines, extra spaces, and convert to lowercase
        const text = label.textContent.toLowerCase().replace(/\s+/g, ' ').trim();

        const matchResult = {
            element: { radio, label },
            text: text,
            isSingleLetterMatch: false,
            isExactMatch: false,
            matchCount: 0
        };

        if (isSingleLetter) {
            // Check if option starts with the letter (e.g. "A" matches "A. Paris")
            const letter = answerParts[0];
            matchResult.isSingleLetterMatch = text.startsWith(letter) || text.startsWith(letter.toUpperCase());
        }

        // Check for EXACT match (AI answer matches the entire option text)
        matchResult.isExactMatch = answerParts.some(part => {
            const optionWithoutPrefix = text.replace(/^[a-d]\s+/, '');
            return part === optionWithoutPrefix || part === text;
        });

        // Check for PARTIAL match
        if (!matchResult.isExactMatch) {
            answerParts.forEach(answerPart => {
                if (text.includes(answerPart)) {
                    matchResult.matchCount++;
                }
            });
        } else {
            matchResult.matchCount = totalParts;
        }

        potentialMatches.push(matchResult);
    });

    // DECISION LOGIC: Priority Order
    // 1. Single Letter Match (if applicable)
    // 2. Exact Text Match
    // 3. Partial Text Match

    const hasSingleLetterMatch = isSingleLetter && potentialMatches.some(m => m.isSingleLetterMatch);
    const hasExactMatch = potentialMatches.some(m => m.isExactMatch);

    potentialMatches.forEach(match => {
        const { radio, label } = match.element;
        let shouldHighlight = false;

        if (isSingleLetter && hasSingleLetterMatch) {
            shouldHighlight = match.isSingleLetterMatch;
        } else if (hasExactMatch) {
            shouldHighlight = match.isExactMatch;
        } else {
            const requiredMatches = totalParts <= 2 ? totalParts : Math.ceil(totalParts * 0.5);
            shouldHighlight = match.matchCount >= requiredMatches;
        }

        if (shouldHighlight) {
            console.log(`✓ Matched option: ${match.text}`);

            // Tick the checkbox/radio
            if (radio && !radio.checked) {
                console.log('  → Ticking input');
                radio.checked = true;
                radio.dispatchEvent(new Event('input', { bubbles: true }));
                radio.dispatchEvent(new Event('change', { bubbles: true }));
                radio.click();
            }

            // Style the correct answer
            label.style.border = '4px solid #2ecc71';
            label.style.backgroundColor = '#e8f8f5';
            label.style.borderRadius = '8px';
            label.style.boxShadow = '0 0 15px rgba(46, 204, 113, 0.5)';

            // Track for cleanup
            highlightedOptions.push(label);

            if (!autoClickTriggered) {
                autoClickTriggered = true;
                chrome.storage.local.get(['autoClickEnabled'], (result) => {
                    if (result.autoClickEnabled !== false) {
                        setTimeout(() => autoClickButtons(), 1000);
                    }
                });
            }
        } else {
            // Reset styling
            label.style.border = '';
            label.style.backgroundColor = '';
            label.style.boxShadow = '';
        }
    });

    // ⚡ Check if any option was matched
    if (highlightedOptions.length === 0) {
        console.warn('⚠️ No matching option found for AI answer:', answersArray);
        chrome.runtime.sendMessage({
            action: 'ERROR',
            message: `No match found! AI says: "${answersArray[0]}" - Please select manually.`
        });
    }
}

// ============================================
// CLEAR ANSWER HIGHLIGHTS
// ============================================
function clearAnswerHighlights() {
    console.log('🧹 Clearing previous answer highlights...');

    highlightedOptions.forEach(label => {
        label.style.border = '';
        label.style.backgroundColor = '';
        label.style.borderRadius = '';
        label.style.boxShadow = '';
    });

    highlightedOptions = [];
}

// ============================================
// AUTO-CLICK BUTTONS
// ============================================
async function autoClickButtons() {
    console.log('🤖 Auto-click triggered');

    // Get the strategy to determine quiz flow
    const hostname = window.location.hostname || 'local_' + window.location.pathname.split('/').pop().replace('.html', '');
    const strategyKey = `quiz_strategy_${hostname}`;
    const result = await chrome.storage.local.get(strategyKey);
    const strategy = result[strategyKey];

    if (!strategy) {
        console.warn('⚠️ No strategy found, using default flow');
        // Fallback to old logic
        defaultAutoClick();
        return;
    }

    console.log('📋 Quiz flow type:', strategy.quiz_flow);
    console.log('📋 Has submit button:', strategy.has_submit_button);
    console.log('📋 Has next button:', strategy.has_next_button);

    // Execute based on quiz flow type
    switch (strategy.quiz_flow) {
        case 'submit-then-next':
            // Click option → Submit → Next
            if (strategy.has_submit_button) {
                const submitBtn = findButtonByText(['Submit', 'Check', 'Verify', 'Confirm']);
                if (submitBtn && !submitBtn.disabled) {
                    console.log('✓ Clicking Submit button');
                    submitBtn.click();

                    // Wait for submit, then click Next
                    if (strategy.has_next_button) {
                        setTimeout(() => {
                            const nextBtn = findButtonByText(['Next', 'NEXT', 'Continue', 'OK']);
                            if (nextBtn && !nextBtn.disabled) {
                                console.log('✓ Clicking Next button');
                                nextBtn.click();
                            }
                        }, 1500);
                    }
                } else {
                    console.warn('⚠️ Submit button not found or disabled');
                }
            }
            break;

        case 'click-then-next':
            // Click option → Next (no submit)
            if (strategy.has_next_button) {
                setTimeout(() => {
                    const nextBtn = findButtonByText(['Next', 'NEXT', 'Continue', 'OK']);
                    if (nextBtn && !nextBtn.disabled) {
                        console.log('✓ Clicking Next button');
                        nextBtn.click();
                    } else {
                        console.warn('⚠️ Next button not found or disabled');
                    }
                }, 1000);
            }
            break;

        case 'auto-advance':
            // Click option → wait for auto-advance (do nothing)
            console.log('✓ Auto-advance mode - waiting for automatic progression');
            break;

        default:
            console.warn('⚠️ Unknown quiz flow type, using default');
            defaultAutoClick();
    }
}

// Fallback to old logic if strategy not found
function defaultAutoClick() {
    const submitBtn = findButtonByText(['Submit', 'Check', 'Verify', 'Confirm']);
    if (submitBtn && !submitBtn.disabled) {
        console.log('✓ Clicking Submit button');
        submitBtn.click();

        setTimeout(() => {
            const nextBtn = findButtonByText(['Next', 'NEXT', 'Continue', 'OK']);
            if (nextBtn && !nextBtn.disabled) {
                console.log('✓ Clicking Next button');
                nextBtn.click();
            }
        }, 1500);
    }
}

function findButtonByText(textOptions) {
    const buttons = document.querySelectorAll('button');
    for (const btn of buttons) {
        const btnText = btn.textContent.trim();
        if (textOptions.some(opt => btnText.includes(opt))) {
            return btn;
        }
    }
    return null;
}

// ============================================
// INSPECTOR TOOL
// ============================================
function toggleInspector(active) {
    isInspecting = active;

    if (active) {
        console.log('🔍 Inspector mode activated');
        document.body.classList.add('groq-cursor-mode');
        document.addEventListener('mouseover', handleHover);
        document.addEventListener('click', handleClick, true);
    } else {
        console.log('🔍 Inspector mode deactivated');
        document.body.classList.remove('groq-cursor-mode');
        document.removeEventListener('mouseover', handleHover);
        document.removeEventListener('click', handleClick, true);
        removeHighlight();
    }
}

function handleHover(event) {
    if (!isInspecting) return;

    event.stopPropagation();
    removeHighlight();

    const container = findBestContainer(event.target);
    if (container) {
        container.classList.add('groq-inspector-active');
        lastHighlightedElement = container;
    }
}

function handleClick(event) {
    if (!isInspecting) return;

    event.preventDefault();
    event.stopPropagation();

    const container = findBestContainer(event.target);
    if (!container) return;

    // Capture the HTML
    const cleanedHTML = cleanHTML(container);
    const hostname = window.location.hostname || 'local_' + window.location.pathname.split('/').pop().replace('.html', '');

    console.log('📦 ========== CAPTURED CONTAINER ==========');
    console.log('Container Element:', container);
    console.log('🌐 Hostname:', hostname);
    console.log('📏 HTML Length:', cleanedHTML.length, 'characters');
    console.log('📄 HTML Preview (first 1000 chars):');
    console.log(cleanedHTML.substring(0, 1000));
    console.log('📤 Sending to AI for analysis...');

    // Visual feedback
    container.classList.remove('groq-inspector-active');
    container.classList.add('groq-captured');

    // Track captured element
    capturedElement = container;

    // Auto-remove highlight after 2 seconds
    setTimeout(() => {
        if (capturedElement) {
            capturedElement.classList.remove('groq-captured');
            capturedElement = null;
            console.log('🧹 Removed inspector capture highlight');
        }
    }, 2000);

    // Deactivate inspector
    toggleInspector(false);

    // Send to background for AI analysis
    chrome.runtime.sendMessage({
        action: 'ANALYZE_HTML',
        html: cleanedHTML,
        hostname: hostname
    });
}

function removeHighlight() {
    if (lastHighlightedElement) {
        lastHighlightedElement.classList.remove('groq-inspector-active');
        lastHighlightedElement = null;
    }
}

function findBestContainer(element) {
    let current = element;
    let depth = 0;
    const maxDepth = 4;

    const quizKeywords = ['question', 'quiz', 'container', 'card', 'wrapper', 'item'];
    const semanticTags = ['SECTION', 'ARTICLE', 'LI', 'FORM', 'MAIN'];

    while (current && current !== document.body && depth < maxDepth) {
        const className = current.className?.toLowerCase() || '';
        const id = current.id?.toLowerCase() || '';

        // Check for quiz-related classes/IDs
        const hasQuizKeyword = quizKeywords.some(keyword =>
            className.includes(keyword) || id.includes(keyword)
        );

        // Check for semantic tags
        const isSemanticTag = semanticTags.includes(current.tagName);

        if (hasQuizKeyword || isSemanticTag) {
            return current;
        }

        current = current.parentElement;
        depth++;
    }

    return element;
}

function cleanHTML(element) {
    const clone = element.cloneNode(true);

    // Remove unwanted elements
    const unwantedSelectors = ['script', 'style', 'svg', 'path', 'noscript', 'iframe'];
    unwantedSelectors.forEach(selector => {
        clone.querySelectorAll(selector).forEach(el => el.remove());
    });

    // Remove inline styles
    clone.querySelectorAll('[style]').forEach(el => el.removeAttribute('style'));

    return clone.outerHTML;
}
