(function () {
  var STORAGE_KEY = 'iii_cookie_consent';
  var POSTHOG_KEY = 'phc_mmRHNXK6hkykVuxVp3JPn7R7sbo3ckSpEZLUKjofCWn6';
  var POSTHOG_HOST = 'https://us.i.posthog.com';

  window.iiiLoadPostHog = function () {
    if (window.__iiiPostHogLoaded) return;
    window.__iiiPostHogLoaded = true;

    !(function (t, e) {
      var o, n, p, r;
      e.__SV ||
        ((window.posthog = e),
        (e._i = []),
        (e.init = function (i, s, a) {
          function g(t, e) {
            var o = e.split('.');
            2 == o.length && ((t = t[o[0]]), (e = o[1]));
            t[e] = function () {
              t.push([e].concat(Array.prototype.slice.call(arguments, 0)));
            };
          }
          ((p = t.createElement('script')).type = 'text/javascript'),
            (p.crossOrigin = 'anonymous'),
            (p.async = !0),
            (p.src =
              s.api_host
                .replace('.i.posthog.com', '-assets.i.posthog.com')
                .replace(/\/$/, '') + '/static/array.js'),
            (r = t.getElementsByTagName('script')[0]).parentNode.insertBefore(p, r);
          var u = e;
          for (
            void 0 !== a ? (u = e[a] = []) : (a = 'posthog'),
              u.people = u.people || [],
              u.toString = function (t) {
                var e = 'posthog';
                return 'posthog' !== a && (e += '.' + a), t || (e += ' (stub)'), e;
              },
              u.people.toString = function () {
                return u.toString(1) + '.people (stub)';
              },
              o =
                'init capture register register_once register_for_session unregister unregister_for_session getFeatureFlag getFeatureFlagPayload isFeatureEnabled reloadFeatureFlags updateEarlyAccessFeatureEnrollment getEarlyAccessFeatures on onFeatureFlags onSessionId getSurveys getActiveMatchingSurveys renderSurvey canRenderSurvey getNextSurveyStep identify setPersonProperties group resetGroups setPersonPropertiesForFlags resetPersonPropertiesForFlags setGroupPropertiesForFlags resetGroupPropertiesForFlags reset get_distinct_id getGroups get_session_id get_session_replay_url alias set_config startSessionRecording stopSessionRecording sessionRecordingStarted captureException loadToolbar get_property getSessionProperty createPersonProfile opt_in_capturing opt_out_capturing has_opted_in_capturing has_opted_out_capturing clear_opt_in_out_capturing debug'.split(
                  ' ',
                ),
              n = 0;
            n < o.length;
            n++
          )
            g(u, o[n]);
          e._i.push([i, s, a]);
        }),
        (e.__SV = 1));
    })(document, window.posthog || []);

    posthog.init(POSTHOG_KEY, {
      api_host: POSTHOG_HOST,
      person_profiles: 'identified_only',
      capture_pageview: true,
      capture_pageleave: true,
    });
  };

  // Records a successful email-form submission in PostHog. Mirrors the timing of
  // iiiNotifyCommonRoomEmail, but intentionally omits the email address — we only
  // need to know that a submission happened, not who it was. Where available, we
  // attach the Common Room visitor id (its signals-sdk-user-id cookie) so the two
  // systems can be joined per visitor.
  window.iiiNotifyPostHogEmailSubmit = function (formLocation) {
    try {
      if (localStorage.getItem(STORAGE_KEY) !== 'accepted') return;
      if (!window.posthog || typeof window.posthog.capture !== 'function') return;
      var props = { form_location: formLocation || 'unknown' };
      var match = document.cookie.match(/(?:^|;\s*)signals-sdk-user-id=([^;]+)/);
      if (match) {
        var crId = decodeURIComponent(match[1]);
        props.common_room_user_id = crId;
        props.$set = { common_room_user_id: crId };
      }
      window.posthog.capture('website_email_submit', props);
    } catch (_) {}
  };

  try {
    if (localStorage.getItem(STORAGE_KEY) === 'accepted') window.iiiLoadPostHog();
  } catch (_) {}
})();
