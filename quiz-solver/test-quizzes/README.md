# Quiz Test Files

This directory contains various quiz formats to test the AI-powered quiz solver extension.

## Test Files

### 1. `aws-style-quiz.html`
**Format**: AWS Academy style  
**Features**:
- Uses `data-test-id` attributes
- Nested `.fr-view` structure
- Radio button options
- Submit + Next button workflow

**Test**: Verify AI can extract selectors like `div[data-test-id="quiz-card-option"]`

---

### 2. `google-mui-quiz.html`
**Format**: Google Developer / Material-UI style  
**Features**:
- MUI class names (`.MuiTypography-h6`, `.MuiFormControlLabel-root`)
- Clean, minimal structure
- "NEXT" button (uppercase)

**Test**: Verify AI avoids dynamic `.css-xxxxx` classes and uses stable MUI classes

---

### 3. `checkbox-multiple-quiz.html`
**Format**: Multiple answer (checkboxes)  
**Features**:
- Checkbox inputs instead of radio
- Multiple correct answers
- Gradient design
- `.option-item` class structure

**Test**: Verify AI detects `input_type: "checkbox"` and handles multiple selections

---

### 4. `dynamic-class-quiz.html`
**Format**: React/styled-components simulation  
**Features**:
- Dynamic classes (`.sc-abc123`, `.css-1x2y3z4`)
- Stable `data-testid` and `data-role` attributes
- Dark theme design

**Test**: **CRITICAL** - Verify AI prioritizes `data-testid` over dynamic classes

---

### 5. `sticky-footer-quiz.html`
**Format**: Sticky footer with separated Next button  
**Features**:
- Question in `.question-container`
- Next button in `.sticky-footer` (outside container)
- Progress indicator

**Test**: **CRITICAL** - Verify AI returns `null` for `submit_next_selector` and fallback works

---

## Testing Workflow

1. **Open each test file** in Chrome
2. **Open the extension** sidebar
3. **Click "Initialize Inspector"**
4. **Hover over the question container** (should see golden outline)
5. **Click to capture**
6. **Wait for AI analysis** (~2-3 seconds)
7. **Check the strategy** in DevTools console:
   ```javascript
   chrome.storage.local.get(null, console.log)
   ```
8. **Click "Solve Question"** to test extraction
9. **Verify** correct answer is highlighted

## Expected Strategies

### AWS Style
```json
{
  "question_selector": ".quiz-card__title .fr-view p",
  "options_selector": "div[data-test-id='quiz-card-option']",
  "input_type": "radio",
  "submit_next_selector": "#nextBtn"
}
```

### Google MUI
```json
{
  "question_selector": ".MuiTypography-h6",
  "options_selector": ".MuiFormControlLabel-root",
  "input_type": "radio",
  "submit_next_selector": "button:contains('NEXT')"
}
```

### Checkbox Multiple
```json
{
  "question_selector": ".question-text",
  "options_selector": ".option-item",
  "input_type": "checkbox",
  "submit_next_selector": "#continueBtn"
}
```

### Dynamic Class
```json
{
  "question_selector": "[data-testid='quiz-question'] h2",
  "options_selector": "[data-role='option-card']",
  "input_type": "radio",
  "submit_next_selector": "[data-action='next']"
}
```

### Sticky Footer
```json
{
  "question_selector": ".question-title",
  "options_selector": ".option-wrapper",
  "input_type": "radio",
  "submit_next_selector": null
}
```

## Success Criteria

✅ AI avoids dynamic classes (`.css-xxxxx`, `.sc-xxxxx`)  
✅ AI prefers stable attributes (`data-testid`, `id`, `name`)  
✅ AI returns `null` when Next button not in container  
✅ Fallback button detection works  
✅ Checkbox quizzes detected correctly  
✅ Hostname-based storage works (different strategies for different files)
