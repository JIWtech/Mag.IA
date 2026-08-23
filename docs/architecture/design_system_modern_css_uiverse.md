# 🎨 Manual de CSS Avançado & Padrões Modernos de UI (Uiverse.io Style)

Este documento consolida as técnicas mais modernas, elegantes e performáticas de **Vanilla CSS** e **Tailwind**, inspiradas nos melhores elementos do **Uiverse.io**. Este guia fica gravado permanentemente na memória do projeto para aplicação em todas as interfaces do **Mag.IA**.

---

## 💎 1. Glassmorphism 2.0 (Vidro Fosco Hiper-Refinado)

O segredo do Glassmorphism moderno é a combinação de **múltiplas sombras internas sutis**, **desfoque com saturação** e **bordas semitransparentes**.

```css
/* Card Glassmorphism Premium */
.glass-card-modern {
  background: rgba(15, 23, 42, 0.65);
  backdrop-filter: blur(16px) saturate(180%);
  -webkit-backdrop-filter: blur(16px) saturate(180%);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 16px;
  box-shadow: 
    0 8px 32px 0 rgba(0, 0, 0, 0.37),
    inset 0 1px 1px 0 rgba(255, 255, 255, 0.1);
  transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}

.glass-card-modern:hover {
  background: rgba(15, 23, 42, 0.75);
  border-color: rgba(255, 255, 255, 0.18);
  transform: translateY(-3px);
  box-shadow: 
    0 14px 40px 0 rgba(0, 0, 0, 0.45),
    inset 0 1px 2px 0 rgba(255, 255, 255, 0.2);
}
```

---

## ✨ 2. Bordas Animadas com Rotação de Gradiente (`@property` + `conic-gradient`)

Técnica de ponta para cards de destaque ou botões de ação principal (CTA) com borda neon que gira continuamente em 360° com aceleração de hardware.

```css
@property --angle {
  syntax: '<angle>';
  initial-value: 0deg;
  inherits: false;
}

.glowing-border-card {
  position: relative;
  background: #0f172a;
  border-radius: 16px;
  padding: 24px;
}

.glowing-border-card::before {
  content: '';
  position: absolute;
  inset: -1.5px;
  border-radius: 17px;
  background: conic-gradient(
    from var(--angle),
    transparent 20%,
    #38bdf8 50%,
    #818cf8 70%,
    transparent 90%
  );
  z-index: -1;
  animation: rotateBorder 4s linear infinite;
}

.glowing-border-card::after {
  content: '';
  position: absolute;
  inset: -6px;
  border-radius: 20px;
  background: conic-gradient(
    from var(--angle),
    transparent 30%,
    rgba(56, 189, 248, 0.3) 60%,
    transparent 85%
  );
  z-index: -2;
  filter: blur(12px);
  animation: rotateBorder 4s linear infinite;
}

@keyframes rotateBorder {
  to {
    --angle: 360deg;
  }
}
```

---

## ⚡ 3. Botões com Efeito de Brilho Dinâmico (Shimmer Sweep)

Efeito onde um reflexo de luz varre o botão ao passar o cursor ou em intervalos regulares.

```css
.btn-shimmer {
  position: relative;
  overflow: hidden;
  padding: 12px 24px;
  font-size: 14px;
  font-weight: 600;
  color: #ffffff;
  background: linear-gradient(135deg, #2563eb, #1d4ed8);
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 10px;
  cursor: pointer;
  box-shadow: 0 4px 14px rgba(37, 99, 235, 0.35);
  transition: transform 0.2s cubic-bezier(0.16, 1, 0.3, 1);
}

.btn-shimmer::before {
  content: '';
  position: absolute;
  top: 0;
  left: -100%;
  width: 100%;
  height: 100%;
  background: linear-gradient(
    90deg,
    transparent,
    rgba(255, 255, 255, 0.25),
    transparent
  );
  transition: left 0.6s ease;
}

.btn-shimmer:hover {
  transform: translateY(-2px);
  box-shadow: 0 6px 20px rgba(37, 99, 235, 0.5);
}

.btn-shimmer:hover::before {
  left: 100%;
}

.btn-shimmer:active {
  transform: translateY(1px);
}
```

---

## 🔘 4. Botão 3D Tátil & Cyberpunk / SaaS Premium

Botões com sensação tátil de clique mecânico real, ideais para formulários e ações rápidas.

```css
.btn-tactile-3d {
  background: #3b82f6;
  color: white;
  font-weight: 600;
  padding: 12px 24px;
  border-radius: 12px;
  border: 1px solid #60a5fa;
  box-shadow: 0 6px 0 #1d4ed8, 0 10px 20px rgba(0, 0, 0, 0.3);
  transition: all 0.15s ease;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.btn-tactile-3d:hover {
  background: #2563eb;
  transform: translateY(2px);
  box-shadow: 0 4px 0 #1d4ed8, 0 6px 14px rgba(0, 0, 0, 0.3);
}

.btn-tactile-3d:active {
  transform: translateY(6px);
  box-shadow: 0 0 0 #1d4ed8, 0 2px 4px rgba(0, 0, 0, 0.2);
}
```

---

## 🖊️ 5. Inputs com Foco Neon e Floating Label

Campos de formulário modernos com brilho perimetral e transições suaves de texto.

```css
.input-group-modern {
  position: relative;
  width: 100%;
}

.input-modern {
  width: 100%;
  padding: 14px 16px;
  background: rgba(15, 23, 42, 0.8);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 10px;
  color: #f8fafc;
  font-size: 14px;
  outline: none;
  transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
}

.input-modern:focus {
  border-color: #38bdf8;
  background: rgba(15, 23, 42, 0.95);
  box-shadow: 
    0 0 0 3px rgba(56, 189, 248, 0.15),
    0 4px 20px rgba(0, 0, 0, 0.25);
}

.input-modern::placeholder {
  color: #64748b;
}
```

---

## 🌀 6. Loaders Modernos e Minimalistas

### A. Anel de Pulso Orbital
```css
.loader-orbit {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  display: inline-block;
  position: relative;
  border: 3px solid transparent;
  border-top-color: #38bdf8;
  animation: spinOrbit 1s ease-in-out infinite;
}

.loader-orbit::after {
  content: '';
  position: absolute;
  inset: 5px;
  border-radius: 50%;
  border: 3px solid transparent;
  border-top-color: #818cf8;
  animation: spinOrbit 0.6s ease-in-out infinite reverse;
}

@keyframes spinOrbit {
  to { transform: rotate(360deg); }
}
```

### B. Barras de Som / Ecualizador Suave
```css
.loader-bars {
  display: flex;
  align-items: center;
  gap: 5px;
  height: 24px;
}

.loader-bar {
  width: 3.5px;
  height: 100%;
  background: #38bdf8;
  border-radius: 3px;
  animation: barWave 1.2s ease-in-out infinite;
}

.loader-bar:nth-child(2) { animation-delay: 0.15s; }
.loader-bar:nth-child(3) { animation-delay: 0.3s; }
.loader-bar:nth-child(4) { animation-delay: 0.45s; }

@keyframes barWave {
  0%, 100% { transform: scaleY(0.25); opacity: 0.4; }
  50% { transform: scaleY(1); opacity: 1; filter: drop-shadow(0 0 4px #38bdf8); }
}
```

---

## 🎨 7. Tokens do Sistema Dark Mode (Design System Mag.IA)

Paleta padrão de alto contraste e elegância:

```css
:root {
  /* Superfícies */
  --bg-main: #060913;
  --surface-panel: #0b111e;
  --surface-card: rgba(15, 23, 42, 0.7);
  --surface-hover: rgba(30, 41, 59, 0.8);
  
  /* Linhas e Contornos */
  --border-subtle: rgba(255, 255, 255, 0.07);
  --border-active: rgba(56, 189, 248, 0.4);
  
  /* Cores de Ação */
  --primary: #38bdf8;
  --primary-glow: rgba(56, 189, 248, 0.25);
  --success: #22c55e;
  --warning: #f59e0b;
  --danger: #ef4444;
  
  /* Tipografia */
  --text-title: #f8fafc;
  --text-body: #94a3b8;
  --text-muted: #64748b;
}
```

---

### 📌 Aplicação Contínua:
Estes padrões estão registrados e serão aplicados automaticamente em novos componentes, cards de conversas, botões e telas do projeto.
