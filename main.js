'use strict';
const live = require('./live/live-packer');

function handleFiles(options, cb) {
    let config = Editor._projectProfile.data['facebook'];
    if (!config.enable || !config.live.enable) {
        cb && cb();
        return;
    }

    //不管处理成功失败，都调用回调，失败了在console打错误log就好了
    live.handleLive(options).then(() => {
        cb && cb();
    });

}

module.exports = {
    load() {
        Editor.Builder.on('before-change-files', handleFiles);
    },

    unload() {
        Editor.Builder.removeListener('before-change-files', handleFiles);
    },

    messages: {}
};
