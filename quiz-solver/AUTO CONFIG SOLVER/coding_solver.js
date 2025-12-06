// ============================================
// CODING QUESTION SOLVER MODULE
// ============================================
// This module handles coding questions (0 options)
// Generates code solutions and displays them in a modal

const CodingSolver = {
    // Main entry point for solving coding questions
    async solve(question, tabId) {
        console.log('💻 Coding question detected!');
        console.log('📝 Question:', question);

        try {
            // Detect programming language from question
            const language = this.detectLanguage(question);
            console.log(`🔍 Detected language: ${language}`);

            // Get selected AI provider
            const settings = await chrome.storage.local.get(['aiProvider']);
            const providerKey = settings.aiProvider || 'GROQ';
            const provider = CONFIG.PROVIDERS[providerKey];

            // Update status
            chrome.runtime.sendMessage({
                action: 'UPDATE_STATUS',
                message: `${provider.name} is generating ${language} code...`
            });

            // Generate code solution
            const code = await this.generateCode(question, language, provider, providerKey);

            console.log('✅ Code generated successfully');
            console.log(code);

            // Send code to content script for display
            chrome.tabs.sendMessage(tabId, {
                action: 'SHOW_CODE_SOLUTION',
                code: code,
                language: language,
                question: question
            });

            // Update sidebar
            chrome.runtime.sendMessage({
                action: 'CODING_SOLUTION',
                code: code,
                language: language,
                question: question
            });

        } catch (error) {
            console.error('❌ Coding solution error:', error);
            chrome.runtime.sendMessage({
                action: 'ERROR',
                message: `Code generation failed: ${error.message}`
            });
        }
    },

    // Detect programming language from question text
    detectLanguage(question) {
        const lowerQuestion = question.toLowerCase();

        // Check for explicit language mentions
        if (lowerQuestion.includes('javascript') || lowerQuestion.includes('js ') || lowerQuestion.includes('node.js')) return 'javascript';
        if (lowerQuestion.includes('python') || lowerQuestion.includes('py ')) return 'python';
        if (lowerQuestion.includes('java') && !lowerQuestion.includes('javascript')) return 'java';
        if (lowerQuestion.includes('c++') || lowerQuestion.includes('cpp')) return 'cpp';
        if (lowerQuestion.includes('c#') || lowerQuestion.includes('csharp')) return 'csharp';
        if (lowerQuestion.includes('typescript') || lowerQuestion.includes('ts ')) return 'typescript';
        if (lowerQuestion.includes('ruby')) return 'ruby';
        if (lowerQuestion.includes('go ') || lowerQuestion.includes('golang')) return 'go';
        if (lowerQuestion.includes('rust')) return 'rust';
        if (lowerQuestion.includes('php')) return 'php';
        if (lowerQuestion.includes('swift')) return 'swift';
        if (lowerQuestion.includes('kotlin')) return 'kotlin';

        // Default to JavaScript (most common for web quizzes)
        return 'javascript';
    },

    // Generate code solution using AI
    async generateCode(question, language, provider, providerKey) {
        const prompt = `You are an expert ${language.toUpperCase()} programmer solving a coding challenge.

${question}

STRICT REQUIREMENTS:
1. Write solution ONLY in ${language.toUpperCase()} - absolutely NO other language
2. Read the problem VERY CAREFULLY - understand input format, output format, and all constraints
3. Implement the EXACT algorithm described in the problem
4. Pay attention to edge cases mentioned
5. Use the specific input/output methods required (stdin/stdout, function parameters, etc.)

OUTPUT REQUIREMENTS:
- ONLY the code - NO markdown, NO explanations, NO triple backticks
- Start directly with code (e.g., "function" for JavaScript, "def" for Python)
- Complete, working solution ready to run
- Use correct ${language} syntax

Generate the ${language.toUpperCase()} solution:`;

        console.log('📤 ========== SENDING TO AI (Code Generation) ==========');
        console.log('Language:', language);
        console.log('Prompt:', prompt);

        let code;

        if (providerKey === 'GROQ') {
            const response = await fetch(provider.endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${provider.apiKey}`
                },
                body: JSON.stringify({
                    model: provider.model,
                    messages: [
                        { role: 'system', content: `You are an expert ${language} programmer. Generate clean, correct code solutions. Follow the problem requirements exactly.` },
                        { role: 'user', content: prompt }
                    ],
                    temperature: 0.3, // Lower for more accurate code
                    max_tokens: 1500
                })
            });

            if (!response.ok) throw new Error(`API Error ${response.status}`);

            const responseData = await response.json();
            console.log('📥 ========== GROQ RESPONSE ==========');
            console.log(JSON.stringify(responseData, null, 2));
            code = responseData.choices[0].message.content.trim();
        } else {
            // Gemini
            const response = await fetch(`${provider.endpoint}?key=${provider.apiKey}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: prompt }] }],
                    generationConfig: {
                        temperature: 0.3,
                        maxOutputTokens: 1500
                    }
                })
            });

            if (!response.ok) throw new Error(`API Error ${response.status}`);

            const responseData = await response.json();
            console.log('📥 ========== GEMINI RESPONSE ==========');
            console.log(JSON.stringify(responseData, null, 2));
            code = responseData.candidates[0].content.parts[0].text.trim();
        }

        // Clean up code (remove markdown code blocks if present)
        code = this.cleanCode(code);

        return code;
    },

    // Clean up AI-generated code
    cleanCode(code) {
        // Remove markdown code blocks
        code = code.replace(/^```[\w]*\n/, '').replace(/\n```$/, '');
        code = code.replace(/^```[\w]*/, '').replace(/```$/, '');

        return code.trim();
    }
};

// Make available to background script
if (typeof module !== 'undefined' && module.exports) {
    module.exports = CodingSolver;
}
