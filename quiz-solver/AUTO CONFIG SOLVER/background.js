// Import coding solver module
importScripts('coding_solver.js');

// ============================================
// OPEN SIDE PANEL ON ICON CLICK
// ============================================
chrome.action.onClicked.addListener((tab) => {
    chrome.sidePanel.open({ windowId: tab.windowId });
});

// ============================================
// CONFIGURATION
// ============================================
const CONFIG = {
    PROVIDERS: {
        GROQ: {
            name: 'Groq Llama 3.3 70B',
            apiKey: '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',
            model: 'llama-3.3-70b-versatile',
            endpoint: 'https://api.groq.com/openai/v1/chat/completions'
        },
        GEMINI: {
            name: 'Gemini 2.0 Flash',
            apiKey: 'AIzaSyAVfBLKPJwBqfxMgXVhZfgJJYRTGQhVBvs',
            model: 'gemini-2.0-flash-exp',
            endpoint: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent'
        }
    }
};

// ============================================
// MESSAGE HANDLERS
// ============================================
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'SOLVE_QUIZ') {
        solveQuiz(request.data, sender.tab.id);
    } else if (request.action === 'ANALYZE_HTML') {
        analyzeQuizStructure(request.html, request.hostname, sender.tab.id);
    } else if (request.action === 'UPDATE_STATUS' || request.action === 'ERROR') {
        // Forward to sidebar
        chrome.runtime.sendMessage(request);
    }
});

// ============================================
// AI STRATEGY GENERATION
// ============================================
async function analyzeQuizStructure(htmlContent, hostname, tabId) {
    console.log('🤖 Analyzing quiz structure for:', hostname);

    try {
        // Send status update
        chrome.runtime.sendMessage({
            action: 'UPDATE_STATUS',
            message: 'AI is analyzing quiz structure...'
        });

        const provider = CONFIG.PROVIDERS.GROQ;

        const systemPrompt = `You are a CSS selector expert. Analyze the provided HTML and generate CSS selectors to extract quiz data.

CRITICAL RULES:
1. AVOID dynamic/hashed classes (e.g., ".css-1x23", ".sc-abc", ".MuiBox-root-123")
2. PREFER stable attributes: "id", "data-testid", "name", "aria-label", "role", distinct class names
3. For "options_selector": Target ONLY the quiz answer options (A, B, C, D), NOT navigation buttons, menu buttons, or page controls
4. Look for containers that hold option labels (A, B, C, D) and option text together
5. The selector MUST match ALL options (typically 4 elements for A, B, C, D)
6. Test your selector mentally - does it ONLY match quiz options, or does it also match other UI elements?
7. Return "null" for "submit_next_selector" if Next button is NOT found in the HTML
8. Return ONLY valid JSON, no markdown, no explanations

⚠️ CRITICAL: USE ONLY VALID CSS SELECTOR SYNTAX
- ❌ NEVER use != (not equals) - this is INVALID CSS
- ❌ NEVER use [role!='button'] - this will cause an error
- ✅ Use :not() for negation - example: button:not([role='button'])
- ✅ Only use valid CSS attribute selectors: =, ~=, |=, ^=, $=, *=
- ✅ Test that your selector is valid CSS before returning it

ANALYSIS STEPS:
1. Find the question text element - look for the main question heading/text
2. Find ALL option elements - look for a repeating pattern of 4 similar elements containing options A, B, C, D
3. Identify what makes options unique from other buttons/elements on the page
4. Look for:
   - Parent containers with quiz-specific classes (e.g., "quiz-option", "answer-choice", "option-container")
   - Input elements (radio/checkbox) grouped together
   - Elements with data attributes (data-option, data-choice, etc.)
   - Div/button/label elements that contain BOTH letter labels (A, B, C, D) AND answer text
   - Clickable elements that represent answer choices
5. Avoid generic selectors like "button", "div", "button[role='button']" - these match too many elements!

WHAT QUIZ OPTIONS LOOK LIKE:
- They typically contain a letter (A, B, C, or D) followed by answer text
- They are usually clickable (div, button, or label elements)
- They appear in a group of 4 similar elements
- They may contain radio buttons or checkboxes inside them
- Example structure: <div class="option">A. 'this' refers to the object...</div>

GOOD SELECTOR EXAMPLES:
✅ ".quiz-option" (if class exists on all 4 options)
✅ "[data-option]" (if data attribute exists)
✅ ".answer-choice-container" (specific class)
✅ "input[type='radio'][name='answer']" (for radio inputs)
✅ ".options-list > div" (if options are direct children)
✅ "[class*='option']" (if class contains 'option')
✅ "div[role='radio']" (if options have radio role)
✅ "label" (if each option is a label element)
✅ "button:not([class*='submit'])" (using :not() correctly)

BAD SELECTOR EXAMPLES:
❌ "button" (too generic, matches all buttons)
❌ "button[role='button']" (still too generic)
❌ "button[role!='button']" (INVALID CSS - will cause error!)
❌ "div" (matches everything)
❌ ".css-abc123" (dynamic/hashed class)

REQUIRED JSON FORMAT:
{
  "question_selector": "CSS selector for question text",
  "options_selector": "CSS selector for ALL quiz option elements (A, B, C, D only)",
  "input_type": "radio" or "checkbox",
  "submit_next_selector": "CSS selector for Next/Submit button" or null,
  "quiz_flow": "submit-then-next" or "click-then-next" or "auto-advance",
  "has_submit_button": true or false,
  "has_next_button": true or false
}

QUIZ FLOW TYPES:
- "submit-then-next": User clicks option → clicks Submit → clicks Next (most common)
- "click-then-next": User clicks option → clicks Next (no submit button)
- "auto-advance": User clicks option → automatically advances to next question (no buttons)

IMPORTANT: 
- The "options_selector" should return exactly 4 elements (for A, B, C, D). If your selector returns more or fewer elements, it's wrong!
- Analyze the HTML to determine if Submit and Next buttons exist
- Determine the quiz flow based on what buttons are present`;

        const userPrompt = `Analyze this quiz HTML and generate selectors:\n\n${htmlContent}`;

        console.log('📤 ========== SENDING TO AI (Strategy Generation) ==========');
        console.log('System Prompt:', systemPrompt);
        console.log('HTML Length:', htmlContent.length, 'characters');
        console.log('HTML Preview:', htmlContent.substring(0, 500) + '...');

        const response = await fetch(provider.endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${provider.apiKey}`
            },
            body: JSON.stringify({
                model: provider.model,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userPrompt }
                ],
                temperature: 0.1,
                max_tokens: 500
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`API Error ${response.status}: ${errorText}`);
        }

        const data = await response.json();
        console.log('📥 ========== FULL API RESPONSE ==========');
        console.log(JSON.stringify(data, null, 2));

        const rawAnswer = data.choices[0].message.content.trim();
        console.log('📥 RAW AI ANSWER:', rawAnswer);
        console.log('📥 RAW AI ANSWER LENGTH:', rawAnswer.length);

        // Parse JSON response
        const jsonMatch = rawAnswer.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            console.error('❌ No JSON found in AI response');
            console.error('Full response was:', rawAnswer);
            throw new Error('No JSON found in AI response. AI returned: ' + rawAnswer.substring(0, 200));
        }

        console.log('📥 JSON MATCH:', jsonMatch[0]);

        let strategy;
        try {
            strategy = JSON.parse(jsonMatch[0]);
        } catch (parseError) {
            console.error('❌ JSON parse error:', parseError);
            console.error('Attempted to parse:', jsonMatch[0]);
            throw new Error(`Failed to parse AI response as JSON: ${parseError.message}`);
        }

        console.log('✅ ========== PARSED STRATEGY ==========');
        console.log(JSON.stringify(strategy, null, 2));
        console.log('question_selector:', strategy.question_selector);
        console.log('options_selector:', strategy.options_selector);
        console.log('input_type:', strategy.input_type);

        // ⚡ SANITIZE SELECTORS - Fix common AI mistakes
        console.log('🧹 Sanitizing selectors...');

        // Fix invalid != operator (common AI mistake)
        if (strategy.options_selector && strategy.options_selector.includes('!=')) {
            console.warn('⚠️ Detected invalid != operator in options_selector');
            console.warn('Original:', strategy.options_selector);

            // Try to convert button[role!='button'] to button:not([role='button'])
            const fixed = strategy.options_selector.replace(/(\w+)\[(\w+)!='([^']+)'\]/g, '$1:not([$2=\'$3\'])');
            console.log('Fixed to:', fixed);
            strategy.options_selector = fixed;
        }

        if (strategy.question_selector && strategy.question_selector.includes('!=')) {
            console.warn('⚠️ Detected invalid != operator in question_selector');
            const fixed = strategy.question_selector.replace(/(\w+)\[(\w+)!='([^']+)'\]/g, '$1:not([$2=\'$3\'])');
            strategy.question_selector = fixed;
        }

        // Validate and set defaults
        if (!strategy.question_selector || !strategy.options_selector) {
            console.error('❌ Missing selectors!');
            console.error('question_selector:', strategy.question_selector);
            console.error('options_selector:', strategy.options_selector);
            throw new Error(`Missing required selectors. AI returned: ${JSON.stringify(strategy)}`);
        }

        if (!strategy.input_type) {
            strategy.input_type = 'radio';
        }

        if (!strategy.submit_next_selector) {
            strategy.submit_next_selector = null;
        }

        // Set defaults for new quiz flow fields
        if (!strategy.quiz_flow) {
            strategy.quiz_flow = 'submit-then-next'; // Default to most common pattern
        }

        if (strategy.has_submit_button === undefined) {
            strategy.has_submit_button = true; // Assume submit button exists by default
        }

        if (strategy.has_next_button === undefined) {
            strategy.has_next_button = true; // Assume next button exists by default
        }

        // ⚡ VALIDATE SELECTORS ON ACTUAL PAGE
        console.log('🔍 Validating selectors on page...');

        const validationResult = await chrome.tabs.sendMessage(tabId, {
            action: 'VALIDATE_SELECTORS',
            selectors: strategy
        });

        console.log('📊 Validation result:', validationResult);

        if (!validationResult.success) {
            console.warn('⚠️ Initial validation failed, trying fallback selectors...');

            // Try common quiz option patterns as fallbacks
            const fallbackSelectors = [
                '.grid button',  // Buttons inside grid container
                '[class*="grid"] button',  // Buttons inside any grid class
                '.gap-3 button',  // Buttons in gap-3 container
                'div.grid > div > button',  // Direct child pattern
                'button[class*="inline-flex"]',  // Common button class pattern
            ];

            let foundValidSelector = false;

            for (const fallbackSelector of fallbackSelectors) {
                console.log(`Trying fallback: ${fallbackSelector}`);

                const fallbackResult = await chrome.tabs.sendMessage(tabId, {
                    action: 'VALIDATE_SELECTORS',
                    selectors: {
                        question_selector: strategy.question_selector,
                        options_selector: fallbackSelector,
                        input_type: strategy.input_type
                    }
                });

                console.log(`Fallback result: ${fallbackResult.optionsCount}/4`);

                if (fallbackResult.success) {
                    console.log(`✅ Found working fallback selector: ${fallbackSelector}`);
                    strategy.options_selector = fallbackSelector;
                    foundValidSelector = true;
                    break;
                }
            }

            if (!foundValidSelector) {
                throw new Error(`Selector validation failed: ${validationResult.error}\n` +
                    `Question found: ${validationResult.questionFound}\n` +
                    `Options found: ${validationResult.optionsCount}/4\n` +
                    `Tried ${fallbackSelectors.length} fallback selectors but none worked.`);
            }
        }

        // Save strategy with hostname key
        const strategyKey = `quiz_strategy_${hostname}`;
        await chrome.storage.local.set({ [strategyKey]: strategy });

        console.log(`💾 Strategy saved for ${hostname}`);

        // Notify sidebar
        chrome.runtime.sendMessage({
            action: 'STRATEGY_SAVED',
            hostname: hostname,
            validation: validationResult
        });

        // Notify content script
        chrome.tabs.sendMessage(tabId, {
            action: 'STRATEGY_APPLIED',
            strategy: strategy
        });

    } catch (error) {
        console.error('❌ Strategy generation error:', error);
        chrome.runtime.sendMessage({
            action: 'ERROR',
            message: `Strategy generation failed: ${error.message}`
        });
    }
}

// ============================================
// AI ANSWER GENERATION
// ============================================
async function solveQuiz(data, tabId) {
    console.log('🚀 solveQuiz called');
    console.log('📝 Question:', data?.question);
    console.log('📋 Options:', data?.options);

    try {
        const { question, options } = data;

        // Validate data - allow 0 options for coding questions
        if (!question || !options) {
            throw new Error("Invalid quiz data");
        }

        // ⚡ VALIDATE: Skip non-quiz content
        // Check if this looks like a result screen or navigation page
        const invalidPatterns = [
            /keep practicing/i,
            /excellent/i,
            /perfect score/i,
            /congratulations/i,
            /try again/i,
            /quiz complete/i,
            /general knowledge trivia/i
        ];

        const isResultScreen = invalidPatterns.some(pattern => pattern.test(question));
        const hasNavigationOptions = options.some(opt =>
            /play again|back to home|start quiz|generate/i.test(opt)
        );

        if (isResultScreen || hasNavigationOptions) {
            console.warn('⚠️ Skipping non-quiz content (result screen or navigation)');
            chrome.runtime.sendMessage({
                action: 'UPDATE_STATUS',
                message: 'Skipped: Not a quiz question (result/navigation screen)'
            });
            return;
        }

        // Validate option count
        // - 0 options = coding question → route to CodingSolver
        // - 3-6 options = multiple choice → continue normal flow  
        // - 1-2 or 7+ options = invalid
        if (options.length === 0) {
            console.log('💻 Coding question detected (0 options)');
            await CodingSolver.solve(question, tabId);
            return;
        }

        if (options.length < 3 || options.length > 6) {
            console.warn(`⚠️ Invalid option count: ${options.length}`);
            chrome.runtime.sendMessage({
                action: 'ERROR',
                message: `Invalid quiz: Found ${options.length} options (expected 0 for coding, or 3-6 for multiple choice)`
            });
            return;
        }

        // Get selected provider
        const settings = await chrome.storage.local.get(['aiProvider']);
        const providerKey = settings.aiProvider || 'GROQ';
        const provider = CONFIG.PROVIDERS[providerKey];

        // Update status
        chrome.runtime.sendMessage({
            action: 'UPDATE_STATUS',
            message: `${provider.name} is analyzing...`
        });

        const prompt = `Question: ${question}\n\nOptions:\n${options.map((opt, i) => `${opt}`).join('\n')}\n\nIMPORTANT: Provide ONLY the EXACT TEXT of the correct answer as it appears in the options above. Do NOT add numbers, letters, or any prefix. Just copy the answer text exactly.`;

        console.log('📤 ========== SENDING TO AI (Answer Generation) ==========');
        console.log('Provider:', provider.name);
        console.log('Prompt:', prompt);

        let rawAnswer;

        if (providerKey === 'GROQ') {
            const response = await fetch(provider.endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${provider.apiKey}`
                },
                body: JSON.stringify({
                    model: provider.model,
                    messages: [{ role: 'user', content: prompt }],
                    temperature: 0.1,
                    max_tokens: 200
                })
            });

            if (!response.ok) throw new Error(`API Error ${response.status}`);

            const responseData = await response.json();
            console.log('📥 ========== GROQ RESPONSE ==========');
            console.log(JSON.stringify(responseData, null, 2));
            rawAnswer = responseData.choices[0].message.content.trim();
        } else {
            // Gemini
            const response = await fetch(`${provider.endpoint}?key=${provider.apiKey}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: prompt }] }]
                })
            });

            if (!response.ok) throw new Error(`API Error ${response.status}`);

            const responseData = await response.json();
            console.log('📥 ========== GEMINI RESPONSE ==========');
            console.log(JSON.stringify(responseData, null, 2));
            rawAnswer = responseData.candidates[0].content.parts[0].text.trim();
        }

        console.log('✅ AI Answer:', rawAnswer);

        // Send result to sidebar
        chrome.runtime.sendMessage({
            action: 'SHOW_RESULT',
            data: {
                question: question,
                options: options,
                answer: rawAnswer,
                model: provider.name
            }
        });

        // Send to content script for highlighting
        chrome.tabs.sendMessage(tabId, {
            action: 'HIGHLIGHT_ANSWER',
            answers: [rawAnswer]
        });

    } catch (error) {
        console.error('❌ Error:', error);
        chrome.runtime.sendMessage({
            action: 'ERROR',
            message: error.message
        });
    }
}
