# Critical Bugs Found & Fixes Needed

## Issue Summary

The AI-powered quiz solver has 3 critical bugs preventing it from working:

### 1. ❌ File Corruption in content.js (Lines 87-150)
**Problem**: The `extractQuizData()` function got corrupted during edits. The async callback inside `chrome.storage.local.get()` is trying to return values, but the parent function needs synchronous return.

**Current broken code**:
```javascript
function extractQuizData() {
    chrome.storage.local.get(['quizMode'], async (result) => {
        // This callback can't return to the parent function!
        if (quizMode === 'CUSTOM') {
            return { question, options }; // ❌ This doesn't work
        }
    });
    // Function ends here with no return!
}
```

**Fix needed**: Make `extractQuizData()` async and use `await` properly:
```javascript
async function extractQuizData() {
    const result = await chrome.storage.local.get(['quizMode']);
    const quizMode = result.quizMode || 'AWS';
    
    if (quizMode === 'CUSTOM') {
        // Extract using strategy
        return { question, options };
    }
    
    // Fall back to old extractors
    return extractFromGoogleQuiz() || extractFromQuizCard() || ...;
}
```

### 2. ❌ Strategy-Based Extraction Not Implemented
**Problem**: When CUSTOM mode is selected and strategy exists, the code logs "Using strategy" but doesn't actually use the AI-generated selectors to extract the quiz.

**What's missing**:
- Use `strategy.question_selector` to find question
- Use `strategy.options_selector` to find options
- Store option elements in `window.__quizOptions` for clicking

**Implementation needed** (lines 100-145 in content.js):
```javascript
const strategy = strategyData[strategyKey];
const questionEl = document.querySelector(strategy.question_selector);
const question = questionEl.innerText.trim();

const optionEls = document.querySelectorAll(strategy.options_selector);
const options = Array.from(optionEls).map(el => el.innerText.trim());

window.__quizOptions = Array.from(optionEls).map(el => ({
    radio: el.querySelector('input') || el,
    label: el
}));

return { question, options };
```

### 3. ❌ extractAndSolve() Doesn't Handle Async
**Problem**: `extractAndSolve()` calls `extractQuizData()` synchronously, but if we make it async, this breaks.

**Fix needed**: Make `extractAndSolve()` async too:
```javascript
async function extractAndSolve(isAuto = false, retryCount = 0) {
    const data = await extractQuizData(); // Add await
    // rest of the code...
}
```

## Recommended Action

**Rewrite the entire `extractQuizData()` function** from scratch with proper async/await handling and strategy-based extraction.

The file is too corrupted to fix with targeted edits. Need a clean rewrite of lines 87-170.
