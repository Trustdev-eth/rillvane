export const LANDING_ORIGIN = 'https://rillvane.trade';
export const APP_ORIGIN = 'https://app.rillvane.trade';

export function siteDestinations(hostname) {
  const production = ['rillvane.trade', 'www.rillvane.trade', 'app.rillvane.trade'].includes(hostname);
  return production ? {app: APP_ORIGIN + '/', landing: LANDING_ORIGIN + '/'} : {app: '/app/', landing: '/'};
}

export function initializeSiteLinks(root = document, hostname = location.hostname) {
  const destinations = siteDestinations(hostname);
  root.querySelectorAll('a[data-site-link]').forEach(link => {
    const href = destinations[link.dataset.siteLink];
    if (href) link.setAttribute('href', href);
  });
}
