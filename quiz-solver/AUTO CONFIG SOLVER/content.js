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
    console.log('ðŸ” Validating selectors:', selectors);

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
        console.error('âŒ Validation error:', error);
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
        console.error('âŒ No strategy found for', hostname);
        chrome.runtime.sendMessage({
            action: 'ERROR',
            message: `No configuration found. Please click "Initialize Inspector" first.`
        });
        return null;
    }

    console.log('ðŸ“‹ Using strategy:', strategy);

    try {
        // Extract question using AI selector
        const questionElement = document.querySelector(strategy.question_selector);
        if (!questionElement) {
            console.error('âŒ Question not found with selector:', strategy.question_selector);
            return null;
        }
        let question = questionElement.innerText.trim();
        
        // Check if incomplete (just "Question 15")
        const isIncomplete = /^(coding\s+)?question\s*\d+/i.test(question);
        if (isIncomplete) {
            console.warn(' Incomplete question, searching parent...');
            const parentText = questionElement.parentElement?.innerText.trim();
            if (parentText && parentText.length > question.length) {
                question = parentText;
                console.log(' Found full question in parent');
            }
        }
        console.log('âœ“ Question extracted:', question);

        // Extract options using AI selector
        const optionElements = document.querySelectorAll(strategy.options_selector);
        const optionsCount = optionElements?.length || 0;

        console.log(`âœ“ Options found: ${optionsCount}`);

        // Allow 0 options for coding questions
        const options = Array.from(optionElements).map(el => el.innerText.trim());

        if (optionsCount > 0) {
            console.log('âœ“ Options extracted:', options);
        } else {
            console.log('ðŸ’» No options found - likely a coding question');
        }

        // Store option elements for later clicking
        const optionData = Array.from(optionElements).map(el => {
            // Find the input element (radio/checkbox)
            const input = el.querySelector('input') || el;
            return { radio: input, label: el };
        });
        window.__quizOptions = optionData;

        console.log('âœ… Strategy-based extraction successful!');
        return { question, options };

    } catch (error) {
        console.error('âŒ Strategy extraction error:', error);
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
    console.log('ðŸ¤– AI Answers:', answersArray);

    const answerParts = [];
    for (const answer of answersArray) {
        const parts = answer
            .split(/\s*\|\s*|[;\n]|(?:\s+and\s+)/i)
            .map(part => part.toLowerCase().replace(/\s+/g, ' ').trim()) // Normalize whitespace
            .filter(part => part.length > 0);
        answerParts.push(...parts);
    }

    console.log('ðŸ“‹ Answer parts to match:', answerParts);

    if (!window.__quizOptions) {
        console.error('âŒ No quiz options found');
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
            console.log(`âœ“ Matched option: ${match.text}`);

            // Tick the checkbox/radio
            if (radio && !radio.checked) {
                console.log('  â†’ Ticking input');
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

    // âš¡ Check if any option was matched
    if (highlightedOptions.length === 0) {
        console.warn('âš ï¸ No matching option found for AI answer:', answersArray);
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
    console.log('ðŸ§¹ Clearing previous answer highlights...');

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
    console.log('ðŸ¤– Auto-click triggered');

    // Get the strategy to determine quiz flow
    const hostname = window.location.hostname || 'local_' + window.location.pathname.split('/').pop().replace('.html', '');
    const strategyKey = `quiz_strategy_${hostname}`;
    const result = await chrome.storage.local.get(strategyKey);
    const strategy = result[strategyKey];

    if (!strategy) {
        console.warn('âš ï¸ No strategy found, using default flow');
        // Fallback to old logic
        defaultAutoClick();
        return;
    }

    console.log('ðŸ“‹ Quiz flow type:', strategy.quiz_flow);
    console.log('ðŸ“‹ Has submit button:', strategy.has_submit_button);
    console.log('ðŸ“‹ Has next button:', strategy.has_next_button);

    // Execute based on quiz flow type
    switch (strategy.quiz_flow) {
        case 'submit-then-next':
            // Click option â†’ Submit â†’ Next
            if (strategy.has_submit_button) {
                const submitBtn = findButtonByText(['Submit', 'Check', 'Verify', 'Confirm']);
                if (submitBtn && !submitBtn.disabled) {
                    console.log('âœ“ Clicking Submit button');
                    submitBtn.click();

                    // Wait for submit, then click Next
                    if (strategy.has_next_button) {
                        setTimeout(() => {
                            const nextBtn = findButtonByText(['Next', 'NEXT', 'Continue', 'OK']);
                            if (nextBtn && !nextBtn.disabled) {
                                console.log('âœ“ Clicking Next button');
                                nextBtn.click();
                            }
                        }, 1500);
                    }
                } else {
                    console.warn('âš ï¸ Submit button not found or disabled');
                }
            }
            break;

        case 'click-then-next':
            // Click option â†’ Next (no submit)
            if (strategy.has_next_button) {
                setTimeout(() => {
                    const nextBtn = findButtonByText(['Next', 'NEXT', 'Continue', 'OK']);
                    if (nextBtn && !nextBtn.disabled) {
                        console.log('âœ“ Clicking Next button');
                        nextBtn.click();
                    } else {
                        console.warn('âš ï¸ Next button not found or disabled');
                    }
                }, 1000);
            }
            break;

        case 'auto-advance':
            // Click option â†’ wait for auto-advance (do nothing)
            console.log('âœ“ Auto-advance mode - waiting for automatic progression');
            break;

        default:
            console.warn('âš ï¸ Unknown quiz flow type, using default');
            defaultAutoClick();
    }
}

// Fallback to old logic if strategy not found
function defaultAutoClick() {
    const submitBtn = findButtonByText(['Submit', 'Check', 'Verify', 'Confirm']);
    if (submitBtn && !submitBtn.disabled) {
        console.log('âœ“ Clicking Submit button');
        submitBtn.click();

        setTimeout(() => {
            const nextBtn = findButtonByText(['Next', 'NEXT', 'Continue', 'OK']);
            if (nextBtn && !nextBtn.disabled) {
                console.log('âœ“ Clicking Next button');
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
        console.log('ðŸ” Inspector mode activated');
        document.body.classList.add('groq-cursor-mode');
        document.addEventListener('mouseover', handleHover);
        document.addEventListener('click', handleClick, true);
    } else {
        console.log('ðŸ” Inspector mode deactivated');
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

    console.log('ðŸ“¦ ========== CAPTURED CONTAINER ==========');
    console.log('Container Element:', container);
    console.log('ðŸŒ Hostname:', hostname);
    console.log('ðŸ“ HTML Length:', cleanedHTML.length, 'characters');
    console.log('ðŸ“„ HTML Preview (first 1000 chars):');
    console.log(cleanedHTML.substring(0, 1000));
    console.log('ðŸ“¤ Sending to AI for analysis...');

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
            console.log('ðŸ§¹ Removed inspector capture highlight');
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
// ============================================
// CODE MODAL DISPLAY (for coding questions)
// ============================================
let globalCodeModalData = null;

function showCodeModal(code, language, question) {
    console.log(" Displaying code modal");
    globalCodeModalData = { code, language, question };

    const existingModal = document.querySelector(".code-modal-overlay");
    if (existingModal) existingModal.remove();

    const overlay = document.createElement("div");
    overlay.className = "code-modal-overlay";

    const modal = document.createElement("div");
    modal.className = "code-modal";

    const header = document.createElement("div");
    header.className = "code-modal-header";
    header.innerHTML = "<h3>AI Generated Solution</h3><button class='code-modal-close'></button>";

    const body = document.createElement("div");
    body.className = "code-modal-body";
    body.innerHTML = `<div class="code-language-badge">${language}</div><pre><code>${escapeHtml(code)}</code></pre>`;

    const footer = document.createElement("div");
    footer.className = "code-modal-footer";
    footer.innerHTML = '<button class="code-modal-copy-btn"> Copy Code</button><button class="code-modal-insert-btn"> Insert into Editor</button>';

    modal.appendChild(header);
    modal.appendChild(body);
    modal.appendChild(footer);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    insertCodeIntoEditor(code);
    console.log(" Code auto-inserted");

    const close = () => { overlay.remove(); globalCodeModalData = null; };
    header.querySelector(".code-modal-close").addEventListener("click", close);
    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });

    const copyBtn = footer.querySelector(".code-modal-copy-btn");
    copyBtn.addEventListener("click", async () => {
        await navigator.clipboard.writeText(code);
        copyBtn.innerHTML = " Copied!";
        copyBtn.classList.add("copied");
        setTimeout(() => { copyBtn.innerHTML = " Copy Code"; copyBtn.classList.remove("copied"); }, 2000);
    });

    footer.querySelector(".code-modal-insert-btn").addEventListener("click", () => insertCodeIntoEditor(code));

    // ========== KEYBOARD SHORTCUTS ==========
    const handleKeyboard = (e) => {
        // Ctrl+\ - Toggle modal visibility
        if (e.ctrlKey && e.key === "\\") {
            e.preventDefault();
            overlay.classList.toggle("hidden");
            console.log("🔄 Modal toggled");
        }
        // Ctrl+Shift+Up/Down - Scroll modal content
        else if (e.ctrlKey && e.shiftKey && e.key === "ArrowUp") {
            e.preventDefault();
            body.scrollBy({ top: -100, behavior: "smooth" });
        }
        else if (e.ctrlKey && e.shiftKey && e.key === "ArrowDown") {
            e.preventDefault();
            body.scrollBy({ top: 100, behavior: "smooth" });
        }
        // Ctrl+Arrow keys - Move modal position
        else if (e.ctrlKey && !e.shiftKey && e.key === "ArrowUp") {
            e.preventDefault();
            const currentTop = parseInt(modal.style.top) || modal.offsetTop;
            modal.style.top = (currentTop - 10) + "px";
        }
        else if (e.ctrlKey && !e.shiftKey && e.key === "ArrowDown") {
            e.preventDefault();
            const currentTop = parseInt(modal.style.top) || modal.offsetTop;
            modal.style.top = (currentTop + 10) + "px";
        }
        else if (e.ctrlKey && !e.shiftKey && e.key === "ArrowLeft") {
            e.preventDefault();
            const currentLeft = parseInt(modal.style.left) || modal.offsetLeft;
            modal.style.left = (currentLeft - 10) + "px";
        }
        else if (e.ctrlKey && !e.shiftKey && e.key === "ArrowRight") {
            e.preventDefault();
            const currentLeft = parseInt(modal.style.left) || modal.offsetLeft;
            modal.style.left = (currentLeft + 10) + "px";
        }
        // Ctrl+Shift+X - Close and delete modal
        else if (e.ctrlKey && e.shiftKey && e.key.toUpperCase() === "X") {
            e.preventDefault();
            close();
            console.log("🗑️ Modal closed");
        }
    };

    document.addEventListener("keydown", handleKeyboard);

    // ========== DRAG FUNCTIONALITY ==========
    let isDragging = false;
    let dragOffsetX = 0;
    let dragOffsetY = 0;

    header.addEventListener("mousedown", (e) => {
        if (e.target === header || e.target === header.querySelector("h3")) {
            isDragging = true;
            const rect = modal.getBoundingClientRect();
            dragOffsetX = e.clientX - rect.left;
            dragOffsetY = e.clientY - rect.top;
            header.style.cursor = "grabbing";
        }
    });

    const handleDrag = (e) => {
        if (isDragging) {
            e.preventDefault();
            modal.style.left = (e.clientX - dragOffsetX) + "px";
            modal.style.top = (e.clientY - dragOffsetY) + "px";
        }
    };

    const stopDrag = () => {
        if (isDragging) {
            isDragging = false;
            header.style.cursor = "";
        }
    };

    document.addEventListener("mousemove", handleDrag);
    document.addEventListener("mouseup", stopDrag);

    // Cleanup all event listeners
    const originalRemove = overlay.remove.bind(overlay);
    overlay.remove = () => {
        document.removeEventListener("keydown", handleKeyboard);
        document.removeEventListener("mousemove", handleDrag);
        document.removeEventListener("mouseup", stopDrag);
        originalRemove();
    };
}

function insertCodeIntoEditor(code) {
    const textarea = document.querySelector("textarea");
    if (textarea) {
        textarea.value = code;
        textarea.dispatchEvent(new Event("input", { bubbles: true }));
        textarea.dispatchEvent(new Event("change", { bubbles: true }));
        console.log(" Code inserted");
    } else {
        console.warn(" No textarea found");
        navigator.clipboard.writeText(code);
    }
}

function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "SHOW_CODE_SOLUTION") {
        showCodeModal(request.code, request.language, request.question);
        sendResponse({ success: true });
    }
});
// ============================================
// CTRL+ENTER SHORTCUT FOR SOLVE BUTTON
// ============================================
document.addEventListener("keydown", (e) => {
    if (e.ctrlKey && e.key === "Enter") {
        e.preventDefault();
        // Trigger solve button click
        extractAndSolve(); // Call directly
        console.log(" Ctrl+Enter pressed - triggering solve");
    }
});
