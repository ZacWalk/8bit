# 8bit – Commodore 64 Emulator + Interactive Guide

A pure JavaScript Commodore 64 emulator embedded alongside chapters of the classic user's guide. Read on the right, experiment instantly on the left.

## Try it out

Visit: https://zacwalk.github.io/8bit/

## Key Files
`c64.js` (emulator) • `c64-roms.js` (ROM data) • `app.js` (layout + buttons + SPA + heuristics) • `styles.css` (layout/theme) • `index.html` & chapters (content).

## TODO
- [ ] Bitmap graphics pipeline (VIC-II layer beyond text mode)
- [ ] SID audio synthesis (WebAudio voices, waveforms, ADSR, simple filter)
- [ ] Disk/tape style IO or PRG import/export (functional LOAD/SAVE shortcuts)
- [ ] Full keyboard matrix & PETSCII mapping (RUN/STOP, RESTORE, graphics chars)
- [ ] Improved timing / raster interrupts (closer cycle accuracy)
- [ ] Optional CRT/scanline or phosphor effect
- [ ] BASIC program export/import UI (save listing, restore session)

## ROM Notice
Bundled BASIC, KERNAL, and character ROM byte arrays are for educational use. They may be copyrighted; replace with legally obtained dumps if required in your jurisdiction.

## Contributing
Hight quality PRs welcome 

## License
MIT (for the code) excluding ROM blobs.

Enjoy hacking BASIC in a tab. 🕹️

