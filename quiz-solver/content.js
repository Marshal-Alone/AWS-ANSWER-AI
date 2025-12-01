let autoModeInterval = null;
let lastSolvedQuestion = '';

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

    // Try Google Quiz format FIRST (MUI-based format)
    const googleQuizResult = extractFromGoogleQuiz();
    if (googleQuizResult) {
        console.log('✓ Extracted using Google Quiz strategy');
        return googleQuizResult;
    }

    // Try quiz card format (AWS Academy format with .quiz-item__card--active)
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
            const isMatch = answerParts.some(answerPart =>
                text.includes(answerPart) || answerPart.includes(text)
            );

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
