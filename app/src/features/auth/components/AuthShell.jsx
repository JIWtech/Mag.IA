import React from 'react';
import { RefreshCcw } from 'lucide-react';
import noriaLogo from '../../../assets/noria_logo.png';

export function AuthShell({ title, children }) {
  return (
    <main className="auth-page auth-loading-page">
      <div className="auth-visual-ambient-aurora cyan auth-loading-aurora" />
      <div className="auth-visual-ambient-aurora violet auth-loading-aurora" />
      <section className="auth-loading-card">
        <div className="brand auth-loading-brand">
          <img src={noriaLogo} alt="NORIA" className="auth-loading-logo-img" />
          <span className="auth-loading-tagline">INTELIGÊNCIA EM MOVIMENTO</span>
        </div>
        {!children && <div className="auth-loading-indicator">
          <RefreshCcw size={20} className="spin" />
        </div>}
        <h1 className="auth-loading-title">{title}</h1>
        {children}
      </section>
    </main>
  );
}
