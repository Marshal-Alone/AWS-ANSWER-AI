# AI Quiz Solver Extension

A clean, AI-powered quiz solver that learns quiz formats dynamically through visual inspection.

## 🎯 Features

- **🔍 Visual Inspector Tool** - Click and select quiz containers like DevTools
- **🤖 AI Strategy Generation** - Groq AI analyzes HTML and generates CSS selectors
- **💾 Hostname-Based Storage** - Different strategies for different websites
- **✅ Smart Answer Matching** - 50% threshold prevents false positives
- **⚡ Auto-Click** - Automatically clicks Submit and Next buttons
- **🔄 Auto Mode** - Continuously solves quizzes at set intervals

## 📁 Files

```
ai-quiz-solver/
├── manifest.json       # Extension configuration
├── content.js          # Inspector tool + async extraction
├── background.js       # AI integration (Groq + Gemini)
├── sidebar.html        # UI structure
├── sidebar.js          # UI logic
├── sidebar.css         # Styling
└── styles.css          # Inspector highlighting
```

## 🚀 How to Use

### 1. Load Extension
1. Open Chrome → `chrome://extensions/`
2. Enable "Developer mode"
3. Click "Load unpacked"
4. Select the `ai-quiz-solver` folder

### 2. Initialize for a Quiz Site
1. Navigate to a quiz page
2. Open the extension sidebar
3. Click "**Initialize Inspector**"
4. Hover over the quiz container (golden outline appears)
5. Click to capture
6. AI analyzes and saves strategy (✅ "Strategy saved!")

### 3. Solve Quizzes
- Click "**Solve Question**" for manual solving
- Enable "**Automatic Mode**" for continuous solving

## 🧠 How It Works

```
1. User clicks "Initialize Inspector"
   ↓
2. User selects quiz container
   ↓
3. HTML sent to Groq AI
   ↓
4. AI generates CSS selectors:
   {
     "question_selector": ".question-text",
     "options_selector": ".option-item",
     "input_type": "radio",
     "submit_next_selector": "#nextBtn"
   }
   ↓
5. Strategy saved to chrome.storage.local
   ↓
6. Future quiz solving uses these selectors
```

## 🎨 AI Providers

- **Groq Llama 3.3 70B** (Default) - Fast and accurate
- **Gemini 2.0 Flash** - Google's latest model

## ⚙️ Configuration

Strategies are stored per hostname:
```javascript
quiz_strategy_www.example.com = {
  question_selector: "...",
  options_selector: "...",
  input_type: "radio",
  submit_next_selector: "..."
}
```

## 🔧 Key Improvements Over Old Version

✅ **Async/Await** - Proper async handling, no callback hell  
✅ **Clean Architecture** - Only AI mode, no hardcoded extractors  
✅ **Better Matching** - 50% threshold prevents single-word false positives  
✅ **File:// Support** - Works with local HTML test files  
✅ **Error Handling** - Clear error messages and validation  

## 🧪 Testing

Test files are available in `../test-quizzes/`:
- `aws-style-quiz.html`
- `google-mui-quiz.html`
- `checkbox-multiple-quiz.html`
- `dynamic-class-quiz.html`
- `sticky-footer-quiz.html`

## 📝 Notes

- First time on a site? Must initialize first
- Strategies persist across browser sessions
- Click "Reset" to re-initialize for a site
- Works on any quiz format (AWS, Google, custom, etc.)

## 🐛 Troubleshooting

**"No configuration found"**  
→ Click "Initialize Inspector" first

**"Content script not loaded"**  
→ Hard refresh the page (Ctrl+Shift+R)

**Wrong answer selected**  
→ AI might need better training data or the quiz format changed

## 🔑 API Keys

Update in `background.js`:
- Groq: `CONFIG.PROVIDERS.GROQ.apiKey`
- Gemini: `CONFIG.PROVIDERS.GEMINI.apiKey`
