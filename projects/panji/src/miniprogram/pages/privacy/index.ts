import { mode, caps, notify } from '../../services/store';
Page({ data: { local: mode() === 'local', capabilities: caps(), version: '2026-10-19' },
  platform() { wx.openPrivacyContract({ fail: notify }); },
});
