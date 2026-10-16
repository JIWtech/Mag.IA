import React from 'react';
import { Building2, X } from 'lucide-react';
import noriaLogo from '../assets/noria_logo.png';

export function AppNavigation({
  active,
  menu = [],
  mobileNavOpen = false,
  onCloseMobileNav,
  onSelectPage,
  selectedTenant = {},
}) {
  return (
    <>
      <aside className="sidebar">
        <div className="brand">
          <img src={noriaLogo} alt="NORIA" className="brand-logo-img" />
        </div>

        <nav className="nav-list">
          {menu.map((item) => {
            const Icon = item.icon;
            const isSelected = active === item.id;
            return (
              <button
                key={item.id}
                type="button"
                className={`nav-item ${isSelected ? 'active' : ''}`}
                onClick={() => onSelectPage?.(item.id)}
              >
                <Icon size={18} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
      </aside>

      {mobileNavOpen && (
        <>
          <div className="mobile-nav-backdrop" onClick={onCloseMobileNav} />
          <aside id="mobile-nav-drawer" className="mobile-nav-drawer" role="dialog" aria-modal="true" aria-label="Navegação principal">
            <div className="mobile-nav-header">
              <div className="mobile-nav-brand">
                <img src={noriaLogo} alt="NORIA" className="brand-logo-img" />
                <div className="mobile-brand-text">
                  <strong>NORIA</strong>
                  <small>Inteligência em movimento</small>
                </div>
              </div>
              <button
                type="button"
                className="icon-button close-drawer-btn"
                onClick={onCloseMobileNav}
                title="Fechar menu"
                aria-label="Fechar menu"
              >
                <X size={18} />
              </button>
            </div>

            <nav className="mobile-nav-list">
              {menu.map((item) => {
                const Icon = item.icon;
                const isSelected = active === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    className={`mobile-nav-item ${isSelected ? 'active' : ''}`}
                    onClick={() => {
                      onSelectPage?.(item.id);
                      onCloseMobileNav?.();
                    }}
                  >
                    <Icon size={18} />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </nav>

            <div className="mobile-nav-footer">
              <small className="mobile-tenant-info"><Building2 size={13} /> {selectedTenant?.name}</small>
            </div>
          </aside>
        </>
      )}
    </>
  );
}
