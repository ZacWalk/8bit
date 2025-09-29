// Core C64 emulator: 6502 CPU + machine state
// Uses existing global ROM byte arrays: rom_basic (8K), rom_kernal (8K), rom_chars.
// This code was written by Zac Walker. You may use this code in your own projects, 
// but please attribute to the original author.
(function() {
    const FLAG_CARRY = 1,
        FLAG_ZERO = 2,
        FLAG_INTERRUPT = 4,
        FLAG_DECIMAL = 8,
        FLAG_BREAK = 16,
        FLAG_CONSTANT = 32,
        FLAG_OVERFLOW = 64,
        FLAG_SIGN = 128;

    const KEYBUF_LEN_ADDR = 0x00C6,
        KEYBUF_ADDR = 0x0277,
        SCREEN_ADDR = 0x0400,
        COLOR_RAM = 0xD800,
        RESET_VEC = 0xFFFC;
    const CYCLES_PER_FRAME = 16421; // PAL approximation
    const PALETTE = [0x000000, 0xFFFFFF, 0x68372B, 0x70A4B2, 0x6F3D86, 0x588D43, 0x352879, 0xB8C76F, 0x6F4F25, 0x433900, 0x9A6759, 0x444444, 0x6C6C6C, 0x9AD284, 0x6C5EB5, 0x959595];

    function getRomBasic() {
        return (typeof rom_basic !== 'undefined') ? rom_basic : ((typeof romBasic !== 'undefined') ? romBasic : new Uint8Array(8192));
    }

    function getRomKernal() {
        return (typeof rom_kernal !== 'undefined') ? rom_kernal : ((typeof romKernal !== 'undefined') ? romKernal : new Uint8Array(8192));
    }

    function getCharacterROM() {
        return (typeof rom_chars !== 'undefined') ? rom_chars : ((typeof romChars !== 'undefined') ? romChars : new Uint8Array(4096));
    }

    class CPU6502 {
        constructor(m) {
            this.m = m;
            this.a = 0;
            this.x = 0;
            this.y = 0;
            this.sp = 0xFD;
            this.pc = 0;
            this.status = FLAG_CONSTANT;
            this.clock = 0;
            this.t = new Uint8Array([7, 6, 2, 8, 3, 3, 5, 5, 3, 2, 2, 2, 4, 4, 6, 6, 2, 5, 2, 8, 4, 4, 6, 6, 2, 4, 2, 7, 4, 4, 7, 7, 6, 6, 2, 8, 3, 3, 5, 5, 4, 2, 2, 2, 4, 4, 6, 6, 2, 5, 2, 8, 4, 4, 6, 6, 2, 4, 2, 7, 4, 4, 7, 7, 6, 6, 2, 8, 3, 3, 5, 5, 3, 2, 2, 2, 3, 4, 6, 6, 2, 5, 2, 8, 4, 4, 6, 6, 2, 4, 2, 7, 4, 4, 7, 7, 6, 6, 2, 8, 3, 3, 5, 5, 4, 2, 2, 2, 5, 4, 6, 6, 2, 5, 2, 8, 4, 4, 6, 6, 2, 4, 2, 7, 4, 4, 7, 7, 2, 6, 2, 6, 3, 3, 3, 3, 2, 2, 2, 2, 4, 4, 4, 4, 2, 6, 2, 6, 4, 4, 4, 4, 2, 5, 2, 5, 5, 5, 5, 5, 2, 6, 2, 6, 3, 3, 3, 3, 2, 2, 2, 2, 4, 4, 4, 4, 2, 5, 2, 5, 4, 4, 4, 4, 2, 4, 2, 4, 4, 4, 4, 4, 2, 6, 2, 8, 3, 3, 5, 5, 2, 2, 2, 2, 4, 4, 6, 6, 2, 5, 2, 8, 4, 4, 6, 6, 2, 4, 2, 7, 4, 4, 7, 7, 2, 6, 2, 8, 3, 3, 5, 5, 2, 2, 2, 2, 4, 4, 6, 6, 2, 5, 2, 8, 4, 4, 6, 6, 2, 4, 2, 7, 4, 4, 7, 7]);
        }
        reset() {
            this.a = this.x = this.y = 0;
            this.sp = 0xFD;
            this.status = FLAG_CONSTANT;
            this.pc = this.read16(RESET_VEC);
            console.log(`CPU Reset: PC set to 0x${this.pc.toString(16).padStart(4, '0')}`);
        }
        read(a) {
            return this.m.read(a & 0xFFFF);
        }
        write(a, v) {
            this.m.write(a & 0xFFFF, v & 0xFF);
        }
        read16(a) {
            const lo = this.read(a);
            return lo | (this.read((a + 1) & 0xFFFF) << 8);
        }
        push(v) {
            this.write(0x100 + this.sp, v);
            this.sp = (this.sp - 1) & 0xFF;
        }
        push16(v) {
            this.push((v >> 8) & 0xFF);
            this.push(v & 0xFF);
        }
        pull() {
            this.sp = (this.sp + 1) & 0xFF;
            return this.read(0x100 + this.sp);
        }
        pull16() {
            const lo = this.pull();
            const hi = this.pull();
            return lo | (hi << 8);
        }
        setF(f, c) {
            if (c) this.status |= f;
            else this.status &= ~f;
        }
        ZN(v) {
            this.setF(FLAG_ZERO, (v & 0xFF) === 0);
            this.setF(FLAG_SIGN, v & 0x80);
        }
        carry(v) {
            this.setF(FLAG_CARRY, v & 0xFF00);
        }
        overflow(r, a, b) {
            this.setF(FLAG_OVERFLOW, (~(a ^ b) & (a ^ r) & 0x80));
        }
        imm() {
            return this.pc++;
        }
        zp() {
            return this.read(this.pc++);
        }
        zpx() {
            return (this.read(this.pc++) + this.x) & 0xFF;
        }
        zpy() {
            return (this.read(this.pc++) + this.y) & 0xFF;
        }
        rel() {
            let o = this.read(this.pc++);
            if (o & 0x80) o |= 0xFF00;
            return o;
        }
        abs() {
            const lo = this.read(this.pc);
            const hi = this.read(this.pc + 1);
            this.pc += 2;
            return lo | (hi << 8);
        }
        absx() {
            return (this.abs() + this.x) & 0xFFFF;
        }
        absy() {
            return (this.abs() + this.y) & 0xFFFF;
        }
        ind() {
            const p = this.abs();
            const lo = this.read(p);
            const hi = this.read((p & 0xFF00) | ((p + 1) & 0xFF));
            return lo | (hi << 8);
        }
        indx() {
            const zp = (this.read(this.pc++) + this.x) & 0xFF;
            const lo = this.read(zp);
            const hi = this.read((zp + 1) & 0xFF);
            return lo | (hi << 8);
        }
        indy() {
            const zp = this.read(this.pc++);
            const lo = this.read(zp);
            const hi = this.read((zp + 1) & 0xFF);
            return ((lo | (hi << 8)) + this.y) & 0xFFFF;
        }
        branch(c, rel) {
            if (c) {
                const old = this.pc;
                this.pc = (this.pc + rel) & 0xFFFF;
                this.clock += ((old & 0xFF00) !== (this.pc & 0xFF00)) ? 2 : 1;
            }
        }
        adc(v) {
            const c = (this.status & FLAG_CARRY) ? 1 : 0;
            const a = this.a;
            let r = a + v + c;
            this.carry(r);
            this.overflow(r & 0xFF, a, v);
            this.a = r & 0xFF;
            this.ZN(this.a);
        }
        sbc(v) {
            this.adc(v ^ 0xFF);
        }
        cmp(r, v) {
            const t = (r - v) & 0x1FF;
            this.setF(FLAG_CARRY, r >= (v & 0xFF));
            this.ZN(t & 0xFF);
        }
        asl(v) {
            const r = (v << 1) & 0x1FF;
            this.carry(r);
            const b = r & 0xFF;
            this.ZN(b);
            return b;
        }
        lsr(v) {
            const c = v & 1;
            const r = (v >> 1) & 0xFF;
            this.setF(FLAG_CARRY, c);
            this.ZN(r);
            return r;
        }
        rol(v) {
            const c = (this.status & FLAG_CARRY) ? 1 : 0;
            const r = ((v << 1) | c) & 0x1FF;
            this.carry(r);
            const b = r & 0xFF;
            this.ZN(b);
            return b;
        }
        ror(v) {
            const c = (this.status & FLAG_CARRY) ? 0x80 : 0;
            const newC = v & 1;
            const r = (c | (v >> 1)) & 0xFF;
            this.setF(FLAG_CARRY, newC);
            this.ZN(r);
            return r;
        }
        execute(limit) {
            let startClock = this.clock;
            let instructions = 0;
            while (this.clock < limit && instructions < 10000) { // Prevent infinite loops
                const op = this.read(this.pc++);
                this.status |= FLAG_CONSTANT;
                let ea, val;
                switch (op) {
                    case 0x00: // BRK
                        this.pc++; // BRK is a 2-byte instruction, but we already incremented PC
                        this.push16(this.pc);
                        this.push(this.status | FLAG_BREAK);
                        this.setF(FLAG_INTERRUPT, true);
                        this.pc = this.read16(0xFFFE);
                        break;
                    case 0x01:
                        ea = this.indx();
                        this.a |= this.read(ea);
                        this.ZN(this.a);
                        break;
                    case 0x05:
                        ea = this.zp();
                        this.a |= this.read(ea);
                        this.ZN(this.a);
                        break;
                    case 0x06:
                        ea = this.zp();
                        this.write(ea, this.asl(this.read(ea)));
                        break;
                    case 0x08:
                        this.push(this.status | FLAG_BREAK);
                        break;
                    case 0x09: // ORA #imm
                        val = this.read(this.pc++);
                        this.a |= val;
                        this.ZN(this.a);
                        break;
                    case 0x0A:
                        this.a = this.asl(this.a);
                        break;
                    case 0x0D:
                        ea = this.abs();
                        this.a |= this.read(ea);
                        this.ZN(this.a);
                        break;
                    case 0x0E:
                        ea = this.abs();
                        this.write(ea, this.asl(this.read(ea)));
                        break;
                    case 0x10:
                        this.branch(!(this.status & FLAG_SIGN), this.rel());
                        break;
                    case 0x11:
                        ea = this.indy();
                        this.a |= this.read(ea);
                        this.ZN(this.a);
                        break;
                    case 0x15:
                        ea = this.zpx();
                        this.a |= this.read(ea);
                        this.ZN(this.a);
                        break;
                    case 0x16:
                        ea = this.zpx();
                        this.write(ea, this.asl(this.read(ea)));
                        break;
                    case 0x18:
                        this.setF(FLAG_CARRY, false);
                        break;
                    case 0x19:
                        ea = this.absy();
                        this.a |= this.read(ea);
                        this.ZN(this.a);
                        break;
                    case 0x1D:
                        ea = this.absx();
                        this.a |= this.read(ea);
                        this.ZN(this.a);
                        break;
                    case 0x1E:
                        ea = this.absx();
                        this.write(ea, this.asl(this.read(ea)));
                        break;
                    case 0x20:
                        ea = this.abs();
                        this.push16((this.pc - 1) & 0xFFFF);
                        this.pc = ea;
                        break;
                    case 0x21:
                        ea = this.indx();
                        this.a &= this.read(ea);
                        this.ZN(this.a);
                        break;
                    case 0x24:
                        ea = this.zp();
                        val = this.read(ea);
                        this.setF(FLAG_ZERO, !(this.a & val));
                        this.setF(FLAG_SIGN, val & 0x80);
                        this.setF(FLAG_OVERFLOW, val & 0x40);
                        break;
                    case 0x25:
                        ea = this.zp();
                        this.a &= this.read(ea);
                        this.ZN(this.a);
                        break;
                    case 0x26:
                        ea = this.zp();
                        this.write(ea, this.rol(this.read(ea)));
                        break;
                    case 0x28:
                        this.status = (this.pull() | FLAG_CONSTANT) & 0xFF;
                        break;
                    case 0x29:
                        ea = this.imm();
                        this.a &= this.read(ea);
                        this.ZN(this.a);
                        break;
                    case 0x2A:
                        this.a = this.rol(this.a);
                        break;
                    case 0x2C:
                        ea = this.abs();
                        val = this.read(ea);
                        this.setF(FLAG_ZERO, !(this.a & val));
                        this.setF(FLAG_SIGN, val & 0x80);
                        this.setF(FLAG_OVERFLOW, val & 0x40);
                        break;
                    case 0x2D:
                        ea = this.abs();
                        this.a &= this.read(ea);
                        this.ZN(this.a);
                        break;
                    case 0x2E:
                        ea = this.abs();
                        this.write(ea, this.rol(this.read(ea)));
                        break;
                    case 0x30:
                        this.branch(this.status & FLAG_SIGN, this.rel());
                        break;
                    case 0x31:
                        ea = this.indy();
                        this.a &= this.read(ea);
                        this.ZN(this.a);
                        break;
                    case 0x35:
                        ea = this.zpx();
                        this.a &= this.read(ea);
                        this.ZN(this.a);
                        break;
                    case 0x36:
                        ea = this.zpx();
                        this.write(ea, this.rol(this.read(ea)));
                        break;
                    case 0x38:
                        this.setF(FLAG_CARRY, true);
                        break;
                    case 0x39:
                        ea = this.absy();
                        this.a &= this.read(ea);
                        this.ZN(this.a);
                        break;
                    case 0x3D:
                        ea = this.absx();
                        this.a &= this.read(ea);
                        this.ZN(this.a);
                        break;
                    case 0x3E:
                        ea = this.absx();
                        this.write(ea, this.rol(this.read(ea)));
                        break;
                    case 0x40:
                        this.status = this.pull();
                        this.status = (this.status & ~FLAG_BREAK) | FLAG_CONSTANT;
                        this.pc = this.pull16();
                        break;
                    case 0x41:
                        ea = this.indx();
                        this.a ^= this.read(ea);
                        this.ZN(this.a);
                        break;
                    case 0x45:
                        ea = this.zp();
                        this.a ^= this.read(ea);
                        this.ZN(this.a);
                        break;
                    case 0x46:
                        ea = this.zp();
                        this.write(ea, this.lsr(this.read(ea)));
                        break;
                    case 0x48:
                        this.push(this.a);
                        break;
                    case 0x49:
                        ea = this.imm();
                        this.a ^= this.read(ea);
                        this.ZN(this.a);
                        break;
                    case 0x4A:
                        this.a = this.lsr(this.a);
                        break;
                    case 0x4C:
                        this.pc = this.abs();
                        break;
                    case 0x4D:
                        ea = this.abs();
                        this.a ^= this.read(ea);
                        this.ZN(this.a);
                        break;
                    case 0x4E:
                        ea = this.abs();
                        this.write(ea, this.lsr(this.read(ea)));
                        break;
                    case 0x50:
                        this.branch(!(this.status & FLAG_OVERFLOW), this.rel());
                        break;
                    case 0x51:
                        ea = this.indy();
                        this.a ^= this.read(ea);
                        this.ZN(this.a);
                        break;
                    case 0x55:
                        ea = this.zpx();
                        this.a ^= this.read(ea);
                        this.ZN(this.a);
                        break;
                    case 0x56:
                        ea = this.zpx();
                        this.write(ea, this.lsr(this.read(ea)));
                        break;
                    case 0x58:
                        this.setF(FLAG_INTERRUPT, false);
                        break;
                    case 0x59:
                        ea = this.absy();
                        this.a ^= this.read(ea);
                        this.ZN(this.a);
                        break;
                    case 0x5D:
                        ea = this.absx();
                        this.a ^= this.read(ea);
                        this.ZN(this.a);
                        break;
                    case 0x5E:
                        ea = this.absx();
                        this.write(ea, this.lsr(this.read(ea)));
                        break;
                    case 0x60:
                        this.pc = (this.pull16() + 1) & 0xFFFF;
                        break;
                    case 0x61:
                        ea = this.indx();
                        this.adc(this.read(ea));
                        break;
                    case 0x65:
                        ea = this.zp();
                        this.adc(this.read(ea));
                        break;
                    case 0x66:
                        ea = this.zp();
                        this.write(ea, this.ror(this.read(ea)));
                        break;
                    case 0x68:
                        this.a = this.pull();
                        this.ZN(this.a);
                        break;
                    case 0x69:
                        ea = this.imm();
                        this.adc(this.read(ea));
                        break;
                    case 0x6A:
                        this.a = this.ror(this.a);
                        break;
                    case 0x6C:
                        this.pc = this.ind();
                        break;
                    case 0x6D:
                        ea = this.abs();
                        this.adc(this.read(ea));
                        break;
                    case 0x6E:
                        ea = this.abs();
                        this.write(ea, this.ror(this.read(ea)));
                        break;
                    case 0x70:
                        this.branch(this.status & FLAG_OVERFLOW, this.rel());
                        break;
                    case 0x71:
                        ea = this.indy();
                        this.adc(this.read(ea));
                        break;
                    case 0x75:
                        ea = this.zpx();
                        this.adc(this.read(ea));
                        break;
                    case 0x76:
                        ea = this.zpx();
                        this.write(ea, this.ror(this.read(ea)));
                        break;
                    case 0x78:
                        this.setF(FLAG_INTERRUPT, true);
                        break;
                    case 0x79:
                        ea = this.absy();
                        this.adc(this.read(ea));
                        break;
                    case 0x7D:
                        ea = this.absx();
                        this.adc(this.read(ea));
                        break;
                    case 0x7E:
                        ea = this.absx();
                        this.write(ea, this.ror(this.read(ea)));
                        break;
                    case 0x81:
                        ea = this.indx();
                        this.write(ea, this.a);
                        break;
                    case 0x84:
                        ea = this.zp();
                        this.write(ea, this.y);
                        break;
                    case 0x85:
                        ea = this.zp();
                        this.write(ea, this.a);
                        break;
                    case 0x86:
                        ea = this.zp();
                        this.write(ea, this.x);
                        break;
                    case 0x88:
                        this.y = (this.y - 1) & 0xFF;
                        this.ZN(this.y);
                        break;
                    case 0x8A:
                        this.a = this.x;
                        this.ZN(this.a);
                        break;
                    case 0x8C:
                        ea = this.abs();
                        this.write(ea, this.y);
                        break;
                    case 0x8D:
                        ea = this.abs();
                        this.write(ea, this.a);
                        break;
                    case 0x8E:
                        ea = this.abs();
                        this.write(ea, this.x);
                        break;
                    case 0x90:
                        this.branch(!(this.status & FLAG_CARRY), this.rel());
                        break;
                    case 0x91:
                        ea = this.indy();
                        this.write(ea, this.a);
                        break;
                    case 0x94:
                        ea = this.zpx();
                        this.write(ea, this.y);
                        break;
                    case 0x95:
                        ea = this.zpx();
                        this.write(ea, this.a);
                        break;
                    case 0x96:
                        ea = this.zpy();
                        this.write(ea, this.x);
                        break;
                    case 0x98:
                        this.a = this.y;
                        this.ZN(this.a);
                        break;
                    case 0x99:
                        ea = this.absy();
                        this.write(ea, this.a);
                        break;
                    case 0x9A:
                        this.sp = this.x;
                        break;
                    case 0x9D:
                        ea = this.absx();
                        this.write(ea, this.a);
                        break;
                    case 0xA0:
                        ea = this.imm();
                        this.y = this.read(ea);
                        this.ZN(this.y);
                        break;
                    case 0xA1:
                        ea = this.indx();
                        this.a = this.read(ea);
                        this.ZN(this.a);
                        break;
                    case 0xA2:
                        ea = this.imm();
                        this.x = this.read(ea);
                        this.ZN(this.x);
                        break;
                    case 0xA4:
                        ea = this.zp();
                        this.y = this.read(ea);
                        this.ZN(this.y);
                        break;
                    case 0xA5:
                        ea = this.zp();
                        this.a = this.read(ea);
                        this.ZN(this.a);
                        break;
                    case 0xA6:
                        ea = this.zp();
                        this.x = this.read(ea);
                        this.ZN(this.x);
                        break;
                    case 0xA8:
                        this.y = this.a;
                        this.ZN(this.y);
                        break;
                    case 0xA9:
                        ea = this.imm();
                        this.a = this.read(ea);
                        this.ZN(this.a);
                        break;
                    case 0xAA:
                        this.x = this.a;
                        this.ZN(this.x);
                        break;
                    case 0xAC:
                        ea = this.abs();
                        this.y = this.read(ea);
                        this.ZN(this.y);
                        break;
                    case 0xAD:
                        ea = this.abs();
                        this.a = this.read(ea);
                        this.ZN(this.a);
                        break;
                    case 0xAE:
                        ea = this.abs();
                        this.x = this.read(ea);
                        this.ZN(this.x);
                        break;
                    case 0xB0:
                        this.branch(this.status & FLAG_CARRY, this.rel());
                        break;
                    case 0xB1:
                        ea = this.indy();
                        this.a = this.read(ea);
                        this.ZN(this.a);
                        break;
                    case 0xB4:
                        ea = this.zpx();
                        this.y = this.read(ea);
                        this.ZN(this.y);
                        break;
                    case 0xB5:
                        ea = this.zpx();
                        this.a = this.read(ea);
                        this.ZN(this.a);
                        break;
                    case 0xB6:
                        ea = this.zpy();
                        this.x = this.read(ea);
                        this.ZN(this.x);
                        break;
                    case 0xB8:
                        this.setF(FLAG_OVERFLOW, false);
                        break;
                    case 0xB9:
                        ea = this.absy();
                        this.a = this.read(ea);
                        this.ZN(this.a);
                        break;
                    case 0xBA:
                        this.x = this.sp;
                        this.ZN(this.x);
                        break;
                    case 0xBC:
                        ea = this.absx();
                        this.y = this.read(ea);
                        this.ZN(this.y);
                        break;
                    case 0xBD:
                        ea = this.absx();
                        this.a = this.read(ea);
                        this.ZN(this.a);
                        break;
                    case 0xBE:
                        ea = this.absy();
                        this.x = this.read(ea);
                        this.ZN(this.x);
                        break;
                    case 0xC0:
                        ea = this.imm();
                        this.cmp(this.y, this.read(ea));
                        break;
                    case 0xC1:
                        ea = this.indx();
                        this.cmp(this.a, this.read(ea));
                        break;
                    case 0xC4:
                        ea = this.zp();
                        this.cmp(this.y, this.read(ea));
                        break;
                    case 0xC5:
                        ea = this.zp();
                        this.cmp(this.a, this.read(ea));
                        break;
                    case 0xC6:
                        ea = this.zp();
                        val = (this.read(ea) - 1) & 0xFF;
                        this.write(ea, val);
                        this.ZN(val);
                        break;
                    case 0xC8:
                        this.y = (this.y + 1) & 0xFF;
                        this.ZN(this.y);
                        break;
                    case 0xC9:
                        ea = this.imm();
                        this.cmp(this.a, this.read(ea));
                        break;
                    case 0xCA:
                        this.x = (this.x - 1) & 0xFF;
                        this.ZN(this.x);
                        break;
                    case 0xCC:
                        ea = this.abs();
                        this.cmp(this.y, this.read(ea));
                        break;
                    case 0xCD:
                        ea = this.abs();
                        this.cmp(this.a, this.read(ea));
                        break;
                    case 0xCE:
                        ea = this.abs();
                        val = (this.read(ea) - 1) & 0xFF;
                        this.write(ea, val);
                        this.ZN(val);
                        break;
                    case 0xD0:
                        this.branch(!(this.status & FLAG_ZERO), this.rel());
                        break;
                    case 0xD1:
                        ea = this.indy();
                        this.cmp(this.a, this.read(ea));
                        break;
                    case 0xD5:
                        ea = this.zpx();
                        this.cmp(this.a, this.read(ea));
                        break;
                    case 0xD6:
                        ea = this.zpx();
                        val = (this.read(ea) - 1) & 0xFF;
                        this.write(ea, val);
                        this.ZN(val);
                        break;
                    case 0xD8:
                        this.setF(FLAG_DECIMAL, false);
                        break;
                    case 0xD9:
                        ea = this.absy();
                        this.cmp(this.a, this.read(ea));
                        break;
                    case 0xDD:
                        ea = this.absx();
                        this.cmp(this.a, this.read(ea));
                        break;
                    case 0xDE:
                        ea = this.absx();
                        val = (this.read(ea) - 1) & 0xFF;
                        this.write(ea, val);
                        this.ZN(val);
                        break;
                    case 0xE0:
                        ea = this.imm();
                        this.cmp(this.x, this.read(ea));
                        break;
                    case 0xE1:
                        ea = this.indx();
                        this.sbc(this.read(ea));
                        break;
                    case 0xE4:
                        ea = this.zp();
                        this.cmp(this.x, this.read(ea));
                        break;
                    case 0xE5:
                        ea = this.zp();
                        this.sbc(this.read(ea));
                        break;
                    case 0xE6:
                        ea = this.zp();
                        val = (this.read(ea) + 1) & 0xFF;
                        this.write(ea, val);
                        this.ZN(val);
                        break;
                    case 0xE8:
                        this.x = (this.x + 1) & 0xFF;
                        this.ZN(this.x);
                        break;
                    case 0xE9:
                        ea = this.imm();
                        this.sbc(this.read(ea));
                        break;
                    case 0xEB:
                        ea = this.imm();
                        this.sbc(this.read(ea));
                        break;
                    case 0xEC:
                        ea = this.abs();
                        this.cmp(this.x, this.read(ea));
                        break;
                    case 0xED:
                        ea = this.abs();
                        this.sbc(this.read(ea));
                        break;
                    case 0xEE:
                        ea = this.abs();
                        val = (this.read(ea) + 1) & 0xFF;
                        this.write(ea, val);
                        this.ZN(val);
                        break;
                    case 0xF0:
                        this.branch(this.status & FLAG_ZERO, this.rel());
                        break;
                    case 0xF1:
                        ea = this.indy();
                        this.sbc(this.read(ea));
                        break;
                    case 0xF5:
                        ea = this.zpx();
                        this.sbc(this.read(ea));
                        break;
                    case 0xF6:
                        ea = this.zpx();
                        val = (this.read(ea) + 1) & 0xFF;
                        this.write(ea, val);
                        this.ZN(val);
                        break;
                    case 0xF8:
                        this.setF(FLAG_DECIMAL, true);
                        break;
                    case 0xF9:
                        ea = this.absy();
                        this.sbc(this.read(ea));
                        break;
                    case 0xFD:
                        ea = this.absx();
                        this.sbc(this.read(ea));
                        break;
                    case 0xFE:
                        ea = this.absx();
                        val = (this.read(ea) + 1) & 0xFF;
                        this.write(ea, val);
                        this.ZN(val);
                        break;
                    default:
                        break;
                }
                this.clock += this.t[op];
                instructions++;
            }
            this.clock -= limit;
            
            // Debug: Log if we hit the instruction limit (potential infinite loop)
            if (instructions >= 10000) {
                console.log(`CPU: Hit instruction limit (${instructions}), PC=0x${this.pc.toString(16)}`);
            }
        }
        irq() {
            if (!(this.status & FLAG_INTERRUPT)) {
                this.push16(this.pc);
                this.push(this.status & ~FLAG_BREAK);
                this.setF(FLAG_INTERRUPT, true);
                // Use hardware IRQ vector from ROM at 0xFFFE/0xFFFF
                this.pc = this.read16(0xFFFE);
            }
        }
        // Force a BRK-like break (used for RUN/STOP approximation)
        forceBreak() {
            // Emulate BRK mechanics similar to opcode 0x00 handling
            this.push16(this.pc);
            this.push(this.status | FLAG_BREAK);
            this.setF(FLAG_INTERRUPT, true);
            this.pc = this.read16(0xFFFE);
        }
    }

    class C64Machine {
        constructor() {
            this.ram = new Uint8Array(65536);
            this.cpu = new CPU6502(this);
            this.reset();
        }
        reset() {
            this.ram.fill(0);
            console.log('Machine reset - clearing RAM and resetting CPU');
            
            // Initialize important C64 memory locations
            // Set up some basic system vectors and initial values
            this.ram[0x0000] = 0x2F;  // Data direction register for port A
            this.ram[0x0001] = 0x07;  // Memory configuration register (RAM/ROM banking)
            
            // Keyboard buffer
            this.ram[0x00C6] = 0x00;  // Keyboard buffer length
            
            // Screen/cursor variables - let ROM initialize these
            this.ram[0x0286] = 0x0E;  // Current color (light blue)
            
            // VIC-II registers (would normally be at 0xD000-0xD3FF)
            this.ram[0xD020] = 0x0E;  // Border color (light blue)
            this.ram[0xD021] = 0x06;  // Background color (blue)
            
            // Set up basic system vectors that KERNAL expects
            // IRQ vector (normally points to KERNAL IRQ handler)
            this.ram[0x0314] = 0x31;  // IRQ low byte
            this.ram[0x0315] = 0xEA;  // IRQ high byte (0xEA31)
            
            // BRK vector  
            this.ram[0x0316] = 0x66;
            this.ram[0x0317] = 0xFE;
            
            // NMI vector
            this.ram[0x0318] = 0x47;
            this.ram[0x0319] = 0xFE;
            
            // Reset CPU - this will read the reset vector from ROM at 0xFFFC/0xFFFD
            // and set the PC to the proper KERNAL cold start routine
            this.cpu.reset();
            
            console.log(`CPU PC set to: 0x${this.cpu.pc.toString(16).padStart(4, '0')}`);
        }
        read(a) {
            const bank = this.ram[1] & 0x07;
            // LORAM (bit 0) and HIRAM (bit 1) control RAM/ROM at A000-BFFF and E000-FFFF
            if (a >= 0xA000 && a < 0xC000 && (bank & 1)) return getRomBasic()[a - 0xA000];
            if (a >= 0xE000 && (bank & 2)) return getRomKernal()[a - 0xE000];

            // CHAREN (bit 2) controls I/O or RAM at D000-DFFF
            if (a >= 0xD000 && a < 0xE000 && (bank & 4)) {
                if (a < 0xD400) { // VIC-II
                    if (a === 0xD012) {
                        const rasterLine = (this.cpu.clock >> 6) % 313;
                        return rasterLine & 0xFF;
                    }
                    if (a === 0xD019) return this.ram[a]; // IRQ status
                    return this.ram[a];
                }
                if (a < 0xD800) return this.ram[a]; // SID
                if (a < 0xDC00) return this.ram[a] & 0x0F; // Color RAM
                if (a < 0xDD00) return this.ram[a]; // CIA1
                if (a < 0xDE00) return this.ram[a]; // CIA2
                if (a < 0xE000) return getCharacterROM()[a - 0xD000];
            }
            
            return this.ram[a];
        }
        write(a, v) {
            const bank = this.ram[1] & 0x07;
            if (a >= 0xA000 && a < 0xC000 && (bank & 1)) return; // ROM
            if (a >= 0xE000 && (bank & 2)) return; // ROM

            if (a >= 0xD000 && a < 0xE000 && (bank & 4)) {
                if (a < 0xD400) { // VIC-II
                    this.ram[a] = v;
                    if (a === 0xD019) this.ram[a] &= ~v; // Writing 1 clears bit
                    return;
                }
                if (a < 0xD800) { this.ram[a] = v; return; } // SID
                if (a < 0xDC00) { this.ram[a] = v & 0x0F; return; } // Color RAM
                if (a < 0xDD00) { this.ram[a] = v; return; } // CIA1
                if (a < 0xDE00) { this.ram[a] = v; return; } // CIA2
                return; // Character ROM
            }
            
            this.ram[a] = v & 0xFF;
        }
        addKey(p) {
            const len = this.ram[KEYBUF_LEN_ADDR];
            if (len < 10) {
                this.ram[KEYBUF_ADDR + len] = p & 0xFF;
                this.ram[KEYBUF_LEN_ADDR] = len + 1;
            }
        }
    }

    class C64Emulator {
        constructor(id) {
            this.canvas = document.getElementById(id);
            this.ctx = this.canvas.getContext('2d');
            this.ctx.imageSmoothingEnabled = false;
            this.scale = 2; // Base scale factor (vertical reference)
            // Internal (logical) resolution includes border: 384x272
            this.canvas.width = 384;
            this.canvas.height = 272;
            // Correct to 4:3 display like original CRT (C64 pixels are slightly taller than wide)
            // We keep vertical scale exact and adjust horizontal to achieve overall 4:3 aspect.
            const displayHeight = this.canvas.height * this.scale; // e.g. 272 * 2 = 544px
            const targetAspect = 4 / 3; // Desired outer aspect ratio
            const displayWidth = Math.round(displayHeight * targetAspect); // width derived from height
            this.canvas.style.height = displayHeight + "px";
            this.canvas.style.width = displayWidth + "px";
            this.canvas.style.maxWidth = displayWidth + "px"; // prevent wider CSS overrides
            this.machine = new C64Machine();
            this.frame = 0;
            this.running = false;
            
            // Debug: check reset vector manually
            console.log('Emulator initialized. Checking reset vector...');
            const resetLo = this.machine.read(0xFFFC);
            const resetHi = this.machine.read(0xFFFD);
            const resetVector = resetLo | (resetHi << 8);
            console.log(`Reset vector: 0x${resetVector.toString(16).padStart(4, '0')} (lo: 0x${resetLo.toString(16)}, hi: 0x${resetHi.toString(16)})`);
            console.log(`Current CPU PC: 0x${this.machine.cpu.pc.toString(16).padStart(4, '0')}`);
        }
        reset() {
            this.machine.reset();
        }
        start() {
            if (!this.running) {
                console.log('Starting emulator main loop...');
                this.running = true;
                this.loop();
            }
        }
        stop() {
            this.running = false;
        }
        breakExecution() {
            // Request a CPU break (approximate RUN/STOP); BASIC will typically handle via its IRQ loop
            try { this.machine.cpu.forceBreak(); } catch(e) { /* ignore */ }
        }
        loop() {
            if (!this.running) return;
            
            // Run CPU - ROM will handle keyboard input and all system operations
            this.machine.cpu.execute(CYCLES_PER_FRAME);
            
            // Trigger IRQ for cursor blinking and other ROM services
            // C64 generates IRQ 60 times per second for raster interrupt
            this.machine.cpu.irq();
            
            // Render every other frame for 30fps
            if (!(this.frame & 1)) this.render();
            this.frame++;
            
            requestAnimationFrame(() => this.loop());
        }
        render() {
            const w = 384, h = 272, // Standard PAL resolution including borders
                img = this.ctx.createImageData(w, h),
                d = img.data,
                ram = this.machine.ram,
                border = ram[0xD020] & 0x0F,
                bg = ram[0xD021] & 0x0F,
                borderColor = PALETTE[border],
                bgColor = PALETTE[bg];

            // Fill with border color
            for (let i = 0; i < w * h; i++) {
                const o = i << 2;
                d[o] = (borderColor >> 16) & 255;
                d[o + 1] = (borderColor >> 8) & 255;
                d[o + 2] = borderColor & 255;
                d[o + 3] = 255;
            }

            const chars = getCharacterROM();
            const screenWidth = 320, screenHeight = 200;
            const borderX = (w - screenWidth) >> 1;
            const borderY = (h - screenHeight) >> 1;

            // Draw background color for the main screen area
            for (let r = 0; r < screenHeight; r++) {
                for (let c = 0; c < screenWidth; c++) {
                    const o = ((r + borderY) * w + (c + borderX)) << 2;
                    d[o] = (bgColor >> 16) & 255;
                    d[o + 1] = (bgColor >> 8) & 255;
                    d[o + 2] = bgColor & 255;
                }
            }

            // Draw characters
            for (let r = 0; r < 25; r++) {
                for (let c = 0; c < 40; c++) {
                    const cell = SCREEN_ADDR + r * 40 + c;
                    const charCode = ram[cell];
                    const color = ram[COLOR_RAM + r * 40 + c] & 0x0F;
                    const glyphAddr = charCode * 8;

                    for (let cy = 0; cy < 8; cy++) {
                        const line = chars[glyphAddr + cy] || 0;
                        for (let cx = 0; cx < 8; cx++) {
                            if (line & (0x80 >> cx)) {
                                const px = borderX + c * 8 + cx;
                                const py = borderY + r * 8 + cy;
                                if (px < w && py < h) {
                                    const o = (py * w + px) << 2;
                                    const col = PALETTE[color];
                                    d[o] = (col >> 16) & 255;
                                    d[o + 1] = (col >> 8) & 255;
                                    d[o + 2] = col & 255;
                                }
                            }
                        }
                    }
                }
            }
            this.ctx.putImageData(img, 0, 0);
        }
        handleKeyPress(e) {
            let code = 0;
            const k = e.key;
            if (k === 'Enter') code = 13;
            else if (k === 'Backspace') code = 20;
            else if (k === 'ArrowLeft') code = 157;
            else if (k === 'ArrowRight') code = 29;
            else if (k === 'ArrowUp') code = 145;
            else if (k === 'ArrowDown') code = 17;
            else if (k.length === 1) code = k.toUpperCase().charCodeAt(0);
            if (code) {
                this.machine.addKey(code);
                e.preventDefault();
            }
        }
        typeText(t) {
            let z = 0;
            for (const ch of t) {
                if (ch === '\r') {
                    // Normalize CR to LF handling; skip explicit processing, will be handled by LF branch
                    continue;
                }
                if (ch === '\n') {
                    setTimeout(() => this.handleKeyPress({
                        key: 'Enter',
                        preventDefault: () => {}
                    }), z);
                    z += 70; // slightly longer pause after a line
                } else {
                    setTimeout(() => this.handleKeyPress({
                        key: ch,
                        preventDefault: () => {}
                    }), z);
                    z += 30;
                }
            }
        }
        snapshot() {
            return {
                ram: Array.from(this.machine.ram),
                cpu: {
                    a: this.machine.cpu.a,
                    x: this.machine.cpu.x,
                    y: this.machine.cpu.y,
                    sp: this.machine.cpu.sp,
                    pc: this.machine.cpu.pc,
                    status: this.machine.cpu.status
                },
                frame: this.frame
            };
        }
        restore(state) {
            if (!state || !state.ram || !state.cpu) return;
            try {
                const r = state.ram;
                if (r.length === 65536) {
                    this.machine.ram.set(r);
                }
                Object.assign(this.machine.cpu, state.cpu);
                this.frame = state.frame || 0;
                console.log('C64 state restored');
            } catch (e) { console.warn('Failed to restore C64 state', e); }
        }
    }

    // Override existing if present
    window.C64Emulator = C64Emulator;
})();

// Session persistence helpers (outside closure for clarity)
(function(){
    function saveState() {
        if (window.c64Emu && typeof window.c64Emu.snapshot === 'function') {
            try {
                const snap = window.c64Emu.snapshot();
                sessionStorage.setItem('c64State', JSON.stringify(snap));
            } catch (e) { /* ignore */ }
        }
    }
    window.addEventListener('beforeunload', saveState);
    window.addEventListener('pagehide', saveState);
})();




