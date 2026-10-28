// Навигация: на телефоне плавающий таб-бар, на десктопе сайдбар. Один список ссылок на оба.

import { NavLink } from 'react-router-dom'
import { Icon, type IconName } from './Icon'

const LINKS: { to: string; label: string; icon: IconName }[] = [
  { to: '/', label: 'Главная', icon: 'home' },
  { to: '/report', label: 'Полки', icon: 'shelf' },
  { to: '/scan', label: 'Обход', icon: 'scan' },
  { to: '/orders', label: 'Заказы', icon: 'package' },
  { to: '/agent', label: 'Агент', icon: 'chat' },
]

export function TabBar() {
  return (
    <nav className="tabbar" aria-label="Основная навигация">
      {LINKS.map((l) =>
        l.to === '/scan' ? (
          <NavLink key={l.to} to={l.to} className="tabbar__scan" aria-label="Новый обход">
            <Icon name="scan" size={22} />
          </NavLink>
        ) : (
          <NavLink key={l.to} to={l.to} end={l.to === '/'} className={({ isActive }) => `tabbar__item${isActive ? ' is-active' : ''}`}>
            <Icon name={l.icon} size={22} />
            <span>{l.label}</span>
          </NavLink>
        ),
      )}
    </nav>
  )
}

export function Sidebar() {
  return (
    <aside className="sidebar" aria-label="Боковое меню">
      <div className="sidebar__brand">
        <div className="sidebar__mark">
          <Icon name="shelf" size={16} />
        </div>
        <div>
          <div style={{ fontWeight: 700 }}>Dukon</div>
          <div className="caption">Магазин у дома</div>
        </div>
      </div>
      {LINKS.filter((l) => l.to !== '/scan').map((l) => (
        <NavLink key={l.to} to={l.to} end={l.to === '/'} className={({ isActive }) => `sidebar__link${isActive ? ' is-active' : ''}`}>
          <Icon name={l.icon} size={18} />
          <span>{l.label}</span>
        </NavLink>
      ))}
      <div className="sidebar__spacer" />
      <NavLink to="/scan" className="btn btn--primary btn--block">
        <Icon name="scan" size={18} />
        Новый обход
      </NavLink>
    </aside>
  )
}
