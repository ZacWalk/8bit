// App logic to provide persistent left-side C64 emulator and dynamic chapter loading + run buttons
(function(){
    const EMU_ID = 'c64-screen';
    const CONTENT_ID = 'c64-dynamic-content';
    const PANE_ID = 'c64-content-pane';

    function ensureLayout() {
        if (document.body.classList.contains('has-c64-layout')) return;
        document.body.classList.add('has-c64-layout');
        
        // Check if an embedded index emulator exists (it should since we're keeping it embedded)
        let existingEmbedded = document.getElementById('embedded-c64-screen');
        let emulatorPane = document.getElementById('c64-emulator-pane');
        let contentPane = document.getElementById(PANE_ID);
        
        if (existingEmbedded && emulatorPane) {
            // Rename canvas id to standard EMU_ID for emulator compatibility
            existingEmbedded.id = EMU_ID;
            // Convert button attributes from data-embed-action to data-c64-action
            emulatorPane.querySelectorAll('[data-embed-action]').forEach(btn => {
                const act = btn.getAttribute('data-embed-action');
                btn.setAttribute('data-c64-action', act);
                btn.removeAttribute('data-embed-action');
            });
        }
        
        // The emulator pane and content pane should already exist in the embedded HTML
        // Just ensure they have the proper structure
        if (!emulatorPane) {
            console.warn('Emulator pane not found - the embedded structure may be incorrect');
        }
        
        if (!contentPane) {
            console.warn('Content pane not found - the embedded structure may be incorrect');
        }
    }

    function initEmulator() {
        if (window.c64Emu) return window.c64Emu;
        if (typeof C64Emulator === 'undefined') {
            console.warn('C64Emulator not loaded yet.');
            return null;
        }
        window.c64Emu = new C64Emulator(EMU_ID);
        // Attempt state restore
        try {
            const saved = sessionStorage.getItem('c64State');
            if (saved) {
                const obj = JSON.parse(saved);
                window.c64Emu.restore(obj);
            }
        } catch(e){}
        window.c64Emu.start();
        document.addEventListener('keydown', e => window.c64Emu && window.c64Emu.handleKeyPress(e));
        setupControlButtons();
        return window.c64Emu;
    }

    function setupControlButtons() {
        const pane = document.getElementById('c64-emulator-pane');
        if (!pane) {
            console.warn('Emulator pane not found for control setup');
            return;
        }
        
        // Remove any existing listeners to avoid duplicates
        pane.removeEventListener('click', handleControlClick);
        pane.addEventListener('click', handleControlClick);
    }

    function handleControlClick(e) {
        const target = e.target.closest('button[data-c64-action], button[data-embed-action]');
        if (!target) return;
        
        // Support both data-c64-action and data-embed-action attributes
        const action = target.getAttribute('data-c64-action') || target.getAttribute('data-embed-action');
        const emu = window.c64Emu;
        if (!emu) {
            console.warn('Emulator not initialized yet');
            return;
        }
        
        switch(action) {
            case 'reset': emu.reset(); break;
            case 'new': emu.typeText('NEW\n'); break;
            case 'list': emu.typeText('LIST\n'); break;
            case 'run': emu.typeText('RUN\n'); break;
            case 'stop': // Approximate RUN/STOP: trigger a forced CPU break/IRQ
                if (typeof emu.breakExecution === 'function') {
                    emu.breakExecution();
                } else {
                    emu.typeText(String.fromCharCode(3)); // fallback
                }
                break;
        }
    }

    // Determine whether a code snippet is likely to be runnable C64 BASIC
    // Heuristics:
    // 1. Contains at least one line that starts with a BASIC line number (e.g. 10 PRINT "HI")
    // 2. OR first non-empty line begins with a recognized immediate BASIC keyword (PRINT, POKE, SYS, etc.)
    // 3. Ignore pure output dumps (e.g., the power-on banner) and non-BASIC examples
    function isC64Runnable(codeText) {
        if (!codeText) return false;
        const lines = codeText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
        if (!lines.length) return false;
        // Line-numbered program?
        if (lines.some(l => /^\d{1,5}\s+/.test(l))) return true;
        // Single / small immediate command? (allow a couple of lines for multi-line direct entry)
        const first = lines[0].toUpperCase();
        const immediateKeywords = /^(PRINT|POKE|SYS|LOAD|RUN|LIST|NEW|FOR|IF|GOTO|GOSUB|REM)\b/;
        if (lines.length <= 4 && immediateKeywords.test(first)) return true;
        return false;
    }

    function enhanceCodeBlocks(root=document) {
        const pres = root.querySelectorAll('pre');
        pres.forEach(pre => {
            if (pre.classList.contains('c64-enhanced')) return;
            const codeEl = pre.querySelector('code');
            if (!codeEl) return;
            const codeText = codeEl.innerText || '';
            if (!isC64Runnable(codeText)) return; // Skip adding button if not runnable BASIC
            pre.classList.add('c64-enhanced','c64-run-wrapper');
            const btn = document.createElement('button');
            btn.textContent = 'Run on C64';
            btn.type = 'button';
            btn.className = 'run-c64-btn';
            btn.addEventListener('click', () => runCodeOnC64(codeText));
            pre.appendChild(btn);
        });
    }

    function runCodeOnC64(codeText) {
        const emu = window.c64Emu || initEmulator();
        if (!emu) return;
        const cleaned = codeText.replace(/\r/g,'');
        // If code looks like direct command (no line numbers) just type and ENTER
        const hasLineNumbers = /^\s*\d+\s+/m.test(cleaned);
        if (hasLineNumbers) {
            emu.typeText('NEW\n');
            setTimeout(()=> emu.typeText(cleaned + '\nRUN\n'), 400);
        } else {
            emu.typeText(cleaned + '\n');
        }
    }

    // Set up navigation for the Table of Contents links on the index page
    function setupIndexNavigation() {
        // Determine if current page is the index (supports /, /index.html)
        const path = location.pathname.split('/').pop();
        if (path && path.length && path !== 'index.html') return; // not index
        
        const tocLinks = document.querySelectorAll('a[href$=".html"]');
        tocLinks.forEach(a => {
            const href = a.getAttribute('href');
            if (!/^(chapter\d+|appendices)\.html$/i.test(href)) return;
            
            a.addEventListener('click', e => {
                e.preventDefault();
                
                // Always try to load content into the right panel first
                loadChapter(href, { fallbackNavigate: true });
            }, { passive: false });
        });
    }

    const cache = new Map();

    async function loadChapter(file, opts={}) {
        const content = document.getElementById(CONTENT_ID);
        if (!content) {
            console.warn('Content pane not found - ensure the embedded layout includes #c64-dynamic-content');
            return;
        }
        
        // Ensure layout is maintained
        ensureLayout();
        
        if (cache.has(file)) {
            content.innerHTML = cache.get(file);
            enhanceCodeBlocks(content);
            window.history.pushState({file}, '', '#' + file.replace('.html',''));
            return;
        }
        
        try {
            const res = await fetch(file, {cache:'force-cache'});
            const html = await res.text();
            const frag = document.createElement('div');
            frag.innerHTML = html;
            
            // Extract only the meaningful content from the chapter file
            // Look for the main container elements that contain the chapter content
            const containers = Array.from(frag.querySelectorAll('.container'));
            let extractedContent = '';
            
            if (containers.length > 0) {
                // If we have containers, extract them all
                containers.forEach(container => {
                    extractedContent += container.outerHTML;
                });
            } else {
                // Fallback: extract body content but skip emulator and script elements
                const body = frag.querySelector('body');
                if (body) {
                    Array.from(body.children).forEach(child => {
                        // Skip emulator pane, script tags, and head elements
                        if (child.id !== 'c64-emulator-pane' && 
                            child.tagName !== 'SCRIPT' && 
                            child.tagName !== 'HEAD') {
                            extractedContent += child.outerHTML;
                        }
                    });
                }
            }
            
            // Update page title if we find one
            const title = frag.querySelector('h1, h2, title');
            if (title) {
                document.title = title.textContent + ' - C64 Guide';
            }
            
            // Cache and display the content
            cache.set(file, extractedContent);
            content.innerHTML = extractedContent;
            enhanceCodeBlocks(content);
            window.history.pushState({file}, '', '#' + file.replace('.html',''));
            
        } catch (err) {
            console.warn('Failed to load chapter via fetch:', err);
            
            // For file:// protocol or fetch failures, show navigation message
            content.innerHTML = `
                <div class="p-8">
                    <div class="bg-yellow-100 border border-yellow-400 text-yellow-700 px-4 py-3 rounded mb-4">
                        <p><strong>Note:</strong> Unable to load chapter content dynamically.</p>
                        <p class="mt-2">For the best experience, serve this site via HTTP using:</p>
                        <p><code class="bg-gray-200 px-2 py-1 rounded">python -m http.server 8000</code></p>
                    </div>
                    <p><a href="${file}" class="text-blue-600 hover:underline" target="_blank">Click here to view ${file} in a new tab</a></p>
                </div>
            `;
        }
    }

    function restoreFromHash() {
        const h = location.hash.replace('#','');
        if (/^(chapter\d+|appendices)$/i.test(h)) {
            loadChapter(h + '.html');
        } else {
            enhanceCodeBlocks();
        }
    }

    window.addEventListener('popstate', restoreFromHash);

    document.addEventListener('DOMContentLoaded', () => {
        ensureLayout();
        initEmulator();
        setupIndexNavigation();
        enhanceCodeBlocks();
        restoreFromHash();

        if (location.protocol === 'file:') {
            console.info('[C64 Guide] Running from file://. For best performance, serve via HTTP server (e.g., "npx serve" or "python -m http.server").');
        }
    });
})();
