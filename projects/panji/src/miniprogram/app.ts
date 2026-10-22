import { release } from './services/release';
App({
  globalData: { release },
  onLaunch() {
    // Cloud identity is only initialized after the user opts into cloud records.
    wx.setInnerAudioOption?.({ obeyMuteSwitch: true });
  },
});
