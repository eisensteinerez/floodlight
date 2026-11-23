/* Floodlight · business and legal pages (#/legal, #/legal/<doc>; also /terms, /privacy, /refunds …).
   These are DRAFT TEMPLATES written for Floodlight's real setup (Render hosting, Stripe payments, Resend email, a single
   session cookie, research only, no betting). They are not legal advice: a lawyer should review them before Floodlight
   charges money, and fill in the highlighted business details. Change TERMS_VERSION in accounts.py when the Terms,
   Privacy Policy or Subscription Terms change in a way members must accept again.
   window.flLegal.render(el, doc) draws a page anywhere (the signed-out front page uses it too). */
(() => {
  const UPDATED = 'November 23, 2026';
  const f = t => `<mark class="lg-fill" title="Fill this in before launch">${t}</mark>`;
  const BIZ = f('[Business legal name]'), ADDR = f('[Business postal address]'), MAIL = f('[support email address]'), LAW = f('[State or country whose law applies]');
  const DOCS = [
    ['terms', 'Terms of Service', 'The agreement for using Floodlight.', () => `
      <h2>1. What Floodlight is</h2><p>Floodlight is a sports research service run by ${BIZ} (“we”). It shows live scores, statistics, player prop lines from third parties, hit rates, and our own estimates (“predictions”). <strong>Floodlight is not a sportsbook.</strong> We don't accept bets, hold your money, or pay prizes.</p>
      <h2>2. Who can use it</h2><p>You must be at least 18, or 21 where your state or country requires it for sports wagering content, and able to form a binding contract. You are responsible for following the laws where you live, including any rules about sports betting.</p>
      <h2>3. Your account</h2><p>Keep your password private and your email current. You're responsible for what happens under your account. Tell us at ${MAIL} if you think someone else has used it. One person per account; Group plans are for the people added to them.</p>
      <h2>4. Plans and payment</h2><p>Free is free. Paid plans are covered by the <a href="#/legal/subscription" data-page="legal" data-arg="subscription">Subscription Terms</a> and the <a href="#/legal/refunds" data-page="legal" data-arg="refunds">Refund Policy</a>, which are part of these terms.</p>
      <h2>5. No guarantee</h2><p>Hit rates describe what already happened. Predictions and “supported edge” are estimates that can be wrong. Lines and data come from third parties and can be late, missing or incorrect. Nothing on Floodlight is financial, betting or legal advice, and you decide what to do with it. See the <a href="#/legal/disclaimer" data-page="legal" data-arg="disclaimer">Prediction Disclaimer</a>.</p>
      <h2>6. Acceptable use</h2><p>Follow the <a href="#/legal/acceptable-use" data-page="legal" data-arg="acceptable-use">Acceptable Use Policy</a>. We may suspend or close accounts that break it.</p>
      <h2>7. Our content</h2><p>The site, its design, our models and our written content belong to us or our licensors. You may use them for your own research and share Floodlight's share cards as the site offers. Statistics and lines belong to their sources (see <a href="#/legal/data-sources" data-page="legal" data-arg="data-sources">Data sources</a>).</p>
      <h2>8. What you post</h2><p>Boards, notes and anything else you save stay yours. You give us permission to store and show them to you, and to anyone you choose to share them with.</p>
      <h2>9. Ending your account</h2><p>You can delete your account at any time from Account, then Your data. We may end or suspend accounts that break these terms, with notice when we reasonably can. Sections 5, 7, 10 and 11 continue after an account ends.</p>
      <h2>10. Limits on our responsibility</h2><p>Floodlight is provided “as is”. To the extent the law allows, we aren't liable for indirect or consequential losses, or for any losses from bets or decisions you make using the service, and our total liability is limited to what you paid us in the 12 months before the claim. Some places don't allow these limits, so they may not apply to you.</p>
      <h2>11. Law and disputes</h2><p>These terms are governed by the law of ${LAW}. ${f('[Dispute resolution: courts or arbitration, and where]')}</p>
      <h2>12. Changes</h2><p>When we change these terms in a way that matters, we'll show the new version when you next sign in and ask you to accept it before you continue. The date at the top shows the current version.</p>
      <h2>13. Contact</h2><p>${BIZ}, ${ADDR}. Email ${MAIL}.</p>`],
    ['privacy', 'Privacy Policy', 'What we collect, why, and your choices.', () => `
      <h2>What we collect</h2><ul>
        <li><strong>Account:</strong> username, email address, a salted hash of your password (never the password itself), display name, photo if you add one, and when you accepted these policies.</li>
        <li><strong>What you save:</strong> followed teams and players, boards, prediction cards, parlays, alerts and settings.</li>
        <li><strong>Sign-in:</strong> a list of your signed-in devices (browser and system name, when you signed in and were last active). We use your IP address briefly to stop abuse (for example, limits on sign-up and password-reset emails) and don't keep it with your account.</li>
        <li><strong>Payments:</strong> handled by Stripe. We keep your Stripe customer number, your plan, card brand, last four digits and expiry, and your receipts. We never see or store your full card number.</li>
        <li><strong>Usage:</strong> which Floodlight features are used (for example, how many Lab searches you made today, so the Free limit works), and first-party product statistics to improve Floodlight.</li></ul>
      <h2>Why</h2><p>To run your account and the features you use, take payments and send receipts, keep accounts secure, answer support requests, and understand which features help people. We don't sell your personal information or use it for advertising.</p>
      <h2>Who else handles it</h2><ul><li>Render (hosting the site), ${f('[Neon, the database, if DATABASE_URL is set]')}</li><li>Stripe (payments)</li><li>Resend (sending email)</li><li>Discord, only if you use the Floodlight bot there</li></ul><p>Each processes data on our behalf under its own privacy and security terms.</p>
      <h2>How long we keep it</h2><p>While your account is open. When you delete it, we delete your account and saved data straight away; backups roll over within ${f('[30]')} days. Receipts and payment records are kept by Stripe for as long as tax law requires.</p>
      <h2>Your choices and rights</h2><p>Download everything we hold about you (Account, Your data, Download), correct it in Account, or delete your account. Depending on where you live (for example the EU, UK or California) you have rights to access, correct, delete and port your data and to object to some uses; email ${MAIL} and we'll answer within 30 days.</p>
      <h2>Security</h2><p>Passwords are hashed with PBKDF2, sign-in links are single-use and expire, two-step sign-in is available, and the session cookie is HttpOnly, Secure and SameSite=Strict.</p>
      <h2>Children</h2><p>Floodlight isn't for anyone under 18. We delete accounts we learn belong to a minor.</p>
      <h2>Changes and contact</h2><p>We'll ask you to accept material changes when you next sign in. Questions: ${MAIL}, ${BIZ}, ${ADDR}.</p>`],
    ['cookies', 'Cookie Policy', 'One sign-in cookie and settings saved on your device.', () => `
      <h2>Cookies we set</h2><table class="pr-tbl"><thead><tr><th scope="col">Name</th><th scope="col">Why</th><th scope="col">How long</th></tr></thead><tbody>
        <tr><td><code>fl_session</code></td><td>Keeps you signed in. Strictly necessary.</td><td>30 days, or until you log out</td></tr></tbody></table>
      <h2>Saved on your device</h2><p>Floodlight keeps settings such as your theme, followed teams before you sign in, dismissed help and recent searches in your browser's local storage. They never leave your device unless you're signed in and they're part of your account settings.</p>
      <h2>Other sites' cookies</h2><p>Stripe sets its own cookies on its checkout pages to prevent fraud. Team logos and player photos load from the sports sites that publish them, which may log the request. We don't use advertising or cross-site tracking cookies.</p>
      <h2>Your control</h2><p>You can clear cookies and site data in your browser at any time; you'll be signed out.</p>`],
    ['refunds', 'Refund Policy', 'When you can get money back.', () => `
      <h2>Free trials</h2><p>Cancel before the trial ends and you're never charged.</p>
      <h2>A renewal you meant to cancel</h2><p>If you're charged for a renewal and haven't used Plus since, ask within 14 days and we'll refund it in full. This applies to monthly and yearly plans.</p>
      <h2>Other cases</h2><p>Otherwise, payments aren't refunded for partial periods; when you cancel, Plus stays on until the end of what you paid for. If Floodlight is unavailable for a long stretch, or we charged you in error, we'll put it right.</p>
      <h2>Gifts</h2><p>An unredeemed gift code can be refunded to the buyer within 14 days of purchase.</p>
      <h2>Deleting your account</h2><p>Deleting ends a plan immediately. Ask for a refund first if one of the cases above applies.</p>
      <h2>How to ask</h2><p>Email ${MAIL} from your account's email with your username and the receipt number. Refunds go back to the original payment method and usually arrive within 5 to 10 business days.</p>
      <p class="lg-q">${f('[Check: consumer law where you sell (for example the EU and UK 14-day withdrawal right) may require more than this.]')}</p>`],
    ['subscription', 'Subscription Terms', 'How paid plans, trials and renewals work.', () => `
      <h2>Plans</h2><p>Plus costs $4.99 a month or $29.99 a year. Group costs $9.99 a month and covers you and up to four other accounts. Prices are in US dollars and ${f('[include / exclude]')} sales tax. The pricing page always shows the current prices.</p>
      <h2>Free trial</h2><p>Each account gets one 7-day free trial. You add a payment method to start it. <strong>Unless you cancel before the trial ends, your plan starts and you're charged the plan price on the date shown when you started the trial, and then every month or year until you cancel.</strong></p>
      <h2>Automatic renewal</h2><p>Paid plans renew automatically at the end of each period at the then-current price, charged to the payment method on file. We email a receipt each time. For yearly plans we email a reminder ${f('[7]')} days before renewal.</p>
      <h2>Cancelling</h2><p>Cancel online at any time: Account, Plan and billing, Cancel plan. No call or email needed. Your plan stays on until the end of the paid period and isn't charged again. You can reactivate before then.</p>
      <h2>Changing plans</h2><p>Switching between monthly, yearly and Group takes effect straight away and is prorated by our payment processor.</p>
      <h2>Price changes</h2><p>We'll give at least 30 days' notice by email before a price change applies to you, and you can cancel before it does.</p>
      <h2>Failed payments</h2><p>If a renewal payment fails, your plan stays on for 7 days while we retry and you update your card. After that it moves to Free.</p>
      <h2>Promotion and gift codes</h2><p>Promotion codes apply only as described when issued. Gift codes give a fixed number of months, never renew, and can't be exchanged for cash.</p>
      <h2>Free plan limits</h2><p>Free includes live scores, 5 Lab searches a day, last-10 hit rates, 1 saved board and 3 followed players. We may change Free's limits; we'll never take away what you've already saved.</p>`],
    ['acceptable-use', 'Acceptable Use Policy', 'What you may not do with Floodlight.', () => `
      <p>Use Floodlight for your own research. Please don't:</p><ul>
        <li>Share your sign-in with people outside your account or Group plan, or resell access.</li>
        <li>Scrape, bulk-download or republish Floodlight's data or predictions, or access the site with bots, except through features we offer.</li>
        <li>Create accounts to abuse free trials, referral rewards or limits.</li>
        <li>Try to break, overload, probe or get around security or plan limits.</li>
        <li>Use Floodlight to run unlicensed betting, to sell “guaranteed” picks, or to mislead anyone about results.</li>
        <li>Upload anything illegal, hateful or harassing, or that you don't have the right to share, in boards, notes, names or photos.</li></ul>
      <p>We may remove content and suspend or close accounts that break this policy. Report misuse to ${MAIL}.</p>`],
    ['disclaimer', 'Prediction Disclaimer', 'What our numbers mean, and what they don’t.', () => `
      <h2>Research, not advice</h2><p>Floodlight's hit rates, predictions, “Floodlight chance”, supported edge and evidence grades are information to help your own research. They are not betting, financial or legal advice, and they are not a promise of any result.</p>
      <h2>Past results</h2><p>A hit rate counts how often something happened in past games. It doesn't mean it will happen next time. Small samples (a few games) are especially unreliable, which is why we show the sample size and an evidence grade next to the numbers.</p>
      <h2>Supported edge</h2><p>Supported edge starts from the raw difference between our estimate and the line, then subtracts for small samples, injuries and lineup uncertainty, missing information and data quality. Every card shows the steps.</p>
      <h2>Our record</h2><p>We publish every graded prediction in Pick History, misses included, with the original line and price saved before the game started, and we show corrections openly. We don't advertise a record until enough picks are graded to mean something.</p>
      <h2>Third-party lines</h2><p>Lines and prices come from PrizePicks, Sleeper and sportsbooks and can change or disappear at any time. Always check the line where you play.</p>
      <h2>Gamble responsibly</h2><p>Only bet where it's legal for you, never bet money you need, and take breaks. If gambling is causing problems, call or text 1-800-GAMBLER (US) or visit ncpgambling.org. Outside the US, visit gamblingtherapy.org.</p>`],
    ['data-sources', 'Data sources', 'Where Floodlight’s numbers come from.', () => `
      <p>Floodlight combines public sports data with its own calculations. We aren't affiliated with or endorsed by these sources, and their names and marks belong to their owners.</p>
      <table class="pr-tbl"><thead><tr><th scope="col">What</th><th scope="col">Where it comes from</th></tr></thead><tbody>
        <tr><td>Scores, schedules, box scores, game logs, injuries (NFL, NBA, WNBA, NHL, college)</td><td>ESPN's public feeds</td></tr>
        <tr><td>Baseball</td><td>MLB Stats API, ESPN; leagues in Asia from their league sites</td></tr>
        <tr><td>Hockey</td><td>NHL API, ESPN</td></tr>
        <tr><td>Soccer matches, lineups and player stats</td><td>FotMob, ESPN</td></tr>
        <tr><td>Transfers and player values</td><td>Transfermarkt</td></tr>
        <tr><td>Tennis, boxing and UFC</td><td>ESPN, Flashscore, TheSportsDB</td></tr>
        <tr><td>Player prop lines</td><td>PrizePicks and Sleeper</td></tr>
        <tr><td>Game odds</td><td>Sportsbook odds feeds and Kalshi event markets</td></tr>
        <tr><td>Hit rates, predictions, supported edge, evidence grades</td><td>Floodlight's own calculations from the data above</td></tr></tbody></table>
      <h2>Freshness</h2><p>Each line shows when it was last verified. When a source is slow or down, Floodlight shows the last data it has with its time, or hides markets it can't verify. The Data status page shows each source's state.</p>
      <h2>Mistakes</h2><p>Sources sometimes get things wrong, and so do we. Report incorrect data from any card; material corrections go in the public correction log.</p>`],
    ['delete-account', 'Deleting your account', 'How to delete your account and what happens.', () => `
      <h2>How</h2><ol><li>Sign in and open <a href="#/account/data" data-page="account" data-arg="data">Account, then Your data</a>.</li><li>Optional: press <strong>Download my data</strong> first to keep a copy.</li><li>Under <strong>Delete your account</strong>, enter your password (and your two-step code if it's on), tick the box and press <strong>Delete my account</strong>.</li></ol>
      <h2>What's deleted</h2><p>Your account, email, password, settings, follows, boards, prediction cards, parlays, votes and photo, straight away. You're signed out on every device. Any paid plan ends immediately and won't renew.</p>
      <h2>What's kept</h2><p>Receipts and payment records stay with Stripe as tax law requires. Floodlight's public prediction record isn't personal data and isn't affected. Backups roll over within ${f('[30]')} days.</p>
      <h2>Can't sign in?</h2><p>Use <a href="#/auth/forgot">Forgot password</a> to get back in first. If you no longer have the email, write to ${MAIL} from any address with your username; we'll verify it's you before deleting.</p>`],
    ['contact', 'Contact', 'How to reach us.', () => `
      <dl class="ac-dl lg-dl"><div><dt>Business</dt><dd>${BIZ}</dd></div><div><dt>Address</dt><dd>${ADDR}</dd></div><div><dt>Email</dt><dd>${MAIL}</dd></div><div><dt>Replies</dt><dd>Within 2 business days</dd></div></dl>
      <h2>Quicker answers</h2><ul><li>Billing, receipts, cancelling: <a href="#/account/billing" data-page="account" data-arg="billing">Account, Plan and billing</a></li><li>Can't sign in: <a href="#/auth/forgot">Forgot password or username</a></li><li>Wrong data on a card: use “Report incorrect data” on the card itself</li></ul>`],
  ];
  const BY = Object.fromEntries(DOCS.map(d => [d[0], d]));

  function render(el, doc) {
    const d = BY[doc];
    const nav = `<nav class="lg-nav" aria-label="Policies"><ul>${DOCS.map(([k, t]) => `<li><a href="#/legal/${k}" data-page="legal" data-arg="${k}"${k === doc ? ' aria-current="page"' : ''}>${t}</a></li>`).join('')}</ul></nav>`;
    const draft = `<div class="lg-draft" role="note"><strong>Draft for review.</strong> These pages are a starting template written for how Floodlight actually works. They aren't legal advice. Have a lawyer review them and fill in the highlighted details before taking payments.</div>`;
    if (!d) {
      el.innerHTML = `<div class="lg-wrap"><header class="pg-head"><div><h1 class="pg-title">Policies</h1><p class="pg-sub">The terms you agree to, how we handle your data, and how plans and refunds work.</p></div></header>${draft}
        <div class="lg-grid">${DOCS.map(([k, t, s]) => `<a class="tile lg-card" href="#/legal/${k}" data-page="legal" data-arg="${k}"><strong>${t}</strong><span>${s}</span></a>`).join('')}</div></div>`;
      return;
    }
    el.innerHTML = `<div class="lg-wrap"><header class="pg-head"><div><h1 class="pg-title">${d[1]}</h1><p class="pg-sub">${d[2]} Last updated ${UPDATED}.</p></div></header>${draft}
      <div class="lg-cols">${nav}<article class="card lg-body">${d[3]()}</article></div></div>`;
  }
  window.flLegal = { render, docs: DOCS.map(d => [d[0], d[1]]) };
  const add = () => window.flPages?.add('legal', { title: 'Policies', fresh: true, render });
  if (window.flPages) add(); else document.addEventListener('DOMContentLoaded', add);
})();
