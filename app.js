// App logic to provide persistent left-side C64 emulator and dynamic chapter loading + run buttons
(function(){
    const EMU_ID = 'c64-screen';
    const CONTENT_ID = 'c64-dynamic-content';
    const PANE_ID = 'c64-content-pane';

    function ensureLayout() {
        if (document.body.classList.contains('has-c64-layout')) return;
        document.body.classList.add('has-c64-layout');
        // Wrap original content
        const original = document.createElement('div');
        original.id = CONTENT_ID;
        // Move current body children into dynamic content (will be replaced if SPA navigates)
        const toMove = Array.from(document.body.childNodes).filter(n => !(n.id === 'c64-emulator-pane'));
        toMove.forEach(n => original.appendChild(n));

        // Create panes
        const emulatorPane = document.createElement('div');
        emulatorPane.id = 'c64-emulator-pane';
        emulatorPane.innerHTML = `\n            <h1>COMMODORE 64</h1>\n            <div id="c64-emulator-wrapper">\n                <canvas id="${EMU_ID}" width="384" height="272"></canvas>\n                <div class="c64-controls">\n                    <button data-c64-action="reset">RESET</button>\n                    <button data-c64-action="new">NEW</button>\n                    <button data-c64-action="list">LIST</button>\n                    <button data-c64-action="run">RUN</button>\n                    <button data-c64-action="stop">STOP (RUN/STOP)</button>\n                </div>\n                <div class="c64-inline-note">State persists while you stay on this tab.</div>\n            </div>`;

        const contentPane = document.createElement('div');
        contentPane.id = PANE_ID;
        contentPane.appendChild(original);

        document.body.innerHTML = ''; // clear
        document.body.appendChild(emulatorPane);
        document.body.appendChild(contentPane);
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
        if (!pane) return;
        pane.addEventListener('click', e => {
            const target = e.target.closest('button[data-c64-action]');
            if (!target) return;
            const action = target.getAttribute('data-c64-action');
            const emu = window.c64Emu;
            if (!emu) return;
            switch(action) {
                case 'reset': emu.reset(); break;
                case 'new': emu.typeText('NEW\n'); break;
                case 'list': emu.typeText('LIST\n'); break;
                case 'run': emu.typeText('RUN\n'); break;
                case 'stop': /* emulate RUN/STOP: send STOP (RUN/STOP isn't implemented; send RESTORE?) */ emu.typeText(String.fromCharCode(3)); break;
            }
        });
    }

    function enhanceCodeBlocks(root=document) {
        const pres = root.querySelectorAll('pre');
        pres.forEach(pre => {
            if (pre.classList.contains('c64-enhanced')) return;
            const codeEl = pre.querySelector('code');
            if (!codeEl) return;
            pre.classList.add('c64-enhanced','c64-run-wrapper');
            const btn = document.createElement('button');
            btn.textContent = 'Run on C64';
            btn.type = 'button';
            btn.className = 'run-c64-btn';
            btn.addEventListener('click', () => runCodeOnC64(codeEl.innerText));
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

    function interceptLinks() {
        // If opened directly from filesystem, skip SPA to avoid fetch(file://) CORS issues
        if (location.protocol === 'file:') return;
        document.addEventListener('click', e => {
            const a = e.target.closest('a');
            if (!a) return;
            const href = a.getAttribute('href');
            if (!href) return;
            if (/^(chapter\d+|appendices)\.html$/i.test(href) || href === 'index.html') {
                e.preventDefault();
                loadChapter(href, { fallbackNavigate: true });
            }
        });
    }

    const cache = new Map();

    async function loadChapter(file, opts={}) {
        const content = document.getElementById(CONTENT_ID);
        if (!content) return;
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
            // Try to extract main container
            let main = frag.querySelector('.container');
            if (!main) main = frag.querySelector('body') || frag;
            const title = frag.querySelector('h1,h2');
            if (title) document.title = title.textContent + ' - C64 Guide';
            const extracted = main.innerHTML;
            cache.set(file, extracted);
            content.innerHTML = extracted;
            enhanceCodeBlocks(content);
            window.history.pushState({file}, '', '#' + file.replace('.html',''));
        } catch (err) {
            if (opts.fallbackNavigate) {
                // As a fallback (e.g., file:// or blocked fetch), perform normal navigation
                window.location.href = file;
            } else {
                content.innerHTML = '<p style="color:red">Failed to load chapter: '+file+'</p>';
            }
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
        interceptLinks();
        enhanceCodeBlocks();
        restoreFromHash();

        if (location.protocol === 'file:') {
            console.info('[C64 Guide] Running from file://; SPA chapter loading disabled. For persistent emulator across chapters, serve via a local HTTP server (e.g., "npx serve" or "python -m http.server").');
        }
    });
})();
