import { el } from './dom';
import { attr, children, prop, ViewNodes } from './view-nodes';

export const settingsSections = [
  { id: 'playback', title: 'Playback', description: 'Choose where music plays and when to reveal it.' },
  { id: 'users', title: 'Users', description: 'Help people return, or manage who uses the room.' },
  { id: 'music-assistant', title: 'Music Assistant', description: 'Connect your music library and speakers.' },
  { id: 'access', title: 'Access & network', description: 'Guest links and uploaded-file connectivity.' },
] as const;
export type SettingsSection = typeof settingsSections[number]['id'];
const fromHash = () => settingsSections.find(section => `#${section.id}` === location.hash)?.id;

/** Section navigation changes visibility, never remounting forms or their live controllers. */
export class SettingsSections {
  readonly element = el('div', undefined, 'settings-layout');
  private navigation = el('nav', undefined, 'settings-navigation');
  private content = el('div', undefined, 'settings-content');
  private nodes = new ViewNodes();
  private selected: SettingsSection = fromHash() ?? 'music-assistant';
  private defaultSection: SettingsSection = 'music-assistant';
  private chosen = Boolean(fromHash());
  private initialized = false;
  constructor(signal: AbortSignal) {
    this.navigation.setAttribute('aria-label', 'Settings sections');
    this.element.append(this.navigation, this.content);
    for (const section of settingsSections) {
      const button = this.nodes.el(`nav-${section.id}`, 'a', undefined, 'settings-section-link'); button.href = `#${section.id}`;
      button.setAttribute('aria-label', section.title);
      children(button, this.nodes.el(`label-${section.id}`, 'span', section.title), this.nodes.el(`hint-${section.id}`, 'small', section.description));
      button.onclick = event => {
        if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault(); this.show(section.id);
      };
      this.navigation.append(button);
      const region = this.nodes.el(`region-${section.id}`, 'section', undefined, 'settings-section');
      region.id = `settings-section-${section.id}`; region.setAttribute('aria-labelledby', `settings-heading-${section.id}`);
      const heading = this.nodes.el(`heading-${section.id}`, 'div', undefined, 'settings-section-heading');
      const title = this.nodes.el(`title-${section.id}`, 'h2', section.title); title.id = `settings-heading-${section.id}`;
      children(heading, title, this.nodes.el(`description-${section.id}`, 'p', section.description, 'muted'));
      region.append(heading); this.content.append(region);
    }
    const restore = () => { this.selected = fromHash() ?? this.defaultSection; this.chosen = true; this.render(); };
    window.addEventListener('popstate', restore, { signal }); window.addEventListener('hashchange', restore, { signal });
    this.render();
  }
  initialize(configured: boolean, authorizationReturn = false) {
    if (this.initialized) return; this.initialized = true;
    this.defaultSection = configured && !authorizationReturn ? 'playback' : 'music-assistant';
    if (!this.chosen) { this.selected = this.defaultSection; this.render(); }
  }
  show(section: SettingsSection) {
    this.chosen = true;
    if (location.hash !== `#${section}`) history.pushState(null, '', `${location.pathname}${location.search}#${section}`);
    this.selected = section; this.render();
  }
  update(section: SettingsSection, ...content: (Node | undefined | false)[]) {
    children(this.nodes.el(`region-${section}`, 'section'), this.nodes.el(`heading-${section}`, 'div'), ...content);
  }
  private render() {
    let hiddenFocus = false;
    for (const section of settingsSections) {
      const active = this.selected === section.id;
      attr(this.nodes.el(`nav-${section.id}`, 'a'), 'aria-current', active ? 'location' : undefined);
      const region = this.nodes.el(`region-${section.id}`, 'section');
      if (!active && region.contains(document.activeElement)) hiddenFocus = true;
      prop(region, 'hidden', !active);
    }
    if (hiddenFocus) this.nodes.el(`nav-${this.selected}`, 'a').focus({ preventScroll: true });
  }
}
