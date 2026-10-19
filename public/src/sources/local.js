// Sources that run entirely on the user's device: phone metadata and mail-domain classification.

import { loadScript } from '../loader.js';

export const FREEMAIL = new Set(['gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'yahoo.com', 'icloud.com', 'me.com', 'gmx.de', 'gmx.net', 'web.de', 't-online.de', 'posteo.de', 'mailbox.org', 'proton.me', 'protonmail.com', 'aol.com', 'yandex.ru', 'mail.ru', 'freenet.de', 'arcor.de', 'tutanota.com', 'tuta.io', 'zoho.com', 'gmx.at', 'gmx.ch', 'bluewin.ch']);
const DISPOSABLE = new Set(['mailinator.com', '10minutemail.com', 'guerrillamail.com', 'trashmail.com', 'temp-mail.org', 'yopmail.com', 'sharklasers.com', 'getnada.com', 'dispostable.com', 'maildrop.cc', 'throwawaymail.com', 'fakeinbox.com', 'mintemail.com', 'mohmal.com', 'emailondeck.com', 'tempmail.dev', 'spamgourmet.com', 'wegwerfmail.de', 'trash-mail.com', 'einrot.com']);

export const phone = {
  id: 'phone-meta',
  name: 'Numbering plan',
  provider: 'libphonenumber-js (Google metadata), on your device',
  homepage: 'https://gitlab.com/catamphetamine/libphonenumber-js',
  terms: 'https://github.com/google/libphonenumber/blob/master/LICENSE',
  licence: 'MIT / Apache-2.0 metadata. No network request',
  category: 'Phone',
  accepts: ['phone'],
  cors: true,
  local: true,

  async run(ctx) {
    await loadScript('/vendor/libphonenumber/libphonenumber-max.js');
    const lib = window.libphonenumber;
    const raw = ctx.entity.value;
    const parsed = lib.parsePhoneNumberFromString(raw, raw.trim().startsWith('+') ? undefined : 'DE');
    if (!parsed) {
      ctx.note('Not parseable as a phone number');
      return;
    }
    const type = parsed.getType?.() || 'unknown';
    const data = { e164: parsed.number, international: parsed.formatInternational(), country: parsed.country, callingCode: parsed.countryCallingCode, type, valid: parsed.isValid(), possible: parsed.isPossible() };
    const evidence = ctx.local('libphonenumber', data);
    const typeLabel = { MOBILE: 'mobile', FIXED_LINE: 'fixed line', FIXED_LINE_OR_MOBILE: 'fixed line or mobile', TOLL_FREE: 'toll free', PREMIUM_RATE: 'premium rate', VOIP: 'VoIP', SHARED_COST: 'shared cost', PERSONAL_NUMBER: 'personal number', UAN: 'company number (UAN)', VOICEMAIL: 'voicemail', PAGER: 'pager' }[type] || 'type unknown';
    ctx.fact('Number', { label: 'International', value: data.international, evidence, mono: true });
    ctx.fact('Number', { label: 'Country', value: `${data.country || '—'} (+${data.callingCode})`, evidence });
    ctx.fact('Number', { label: 'Number type', value: typeLabel, evidence });
    ctx.fact('Number', { label: 'Valid', value: data.valid ? 'Valid for the numbering plan' : data.possible ? 'Possible length, but not a valid range' : 'Not valid', evidence, muted: !data.valid });
    ctx.finding({
      title: `${data.international} is ${data.valid ? 'a valid' : 'not a valid'} ${typeLabel} number in ${data.country || 'an unknown region'}`,
      detail: raw.trim().startsWith('+') ? 'Computed locally from the numbering plan. Says nothing about who holds the number.' : 'No country code given, so German numbering was assumed. Computed locally.',
      confidence: data.valid ? 'confirmed' : 'lead',
      evidence,
    });
  },
};

export const mailDomain = {
  id: 'mail-domain',
  name: 'Mail domain',
  provider: 'Indizia lists, on your device',
  homepage: 'https://github.com/disposable-email-domains/disposable-email-domains',
  terms: '',
  licence: 'Small built-in lists of consumer and disposable mail providers',
  category: 'Email',
  accepts: ['email'],
  cors: true,
  local: true,

  async run(ctx) {
    const domain = ctx.entity.value.split('@')[1];
    const kind = DISPOSABLE.has(domain) ? 'disposable' : FREEMAIL.has(domain) ? 'consumer' : 'organisation';
    const evidence = ctx.local('mail-domain', { domain, kind });
    const text = {
      disposable: 'a disposable (throwaway) mail service',
      consumer: 'a consumer mail provider, so the domain says nothing about an organisation',
      organisation: 'not a known consumer or throwaway provider, so it likely belongs to an organisation',
    }[kind];
    ctx.fact('Mail', { label: 'Domain', value: domain, evidence, mono: true });
    ctx.fact('Mail', { label: 'Provider type', value: kind, evidence });
    ctx.finding({ title: `${domain} is ${text}`, confidence: kind === 'organisation' ? 'plausible' : 'confirmed', evidence, pivots: kind === 'organisation' ? [{ type: 'domain', value: domain }] : [] });
    if (kind === 'organisation') ctx.pivot({ type: 'domain', value: domain }, 'mail domain');
  },
};
