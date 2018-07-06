'use strict';
const live = require('./live/live-packer');

function handleFiles(options, cb) {
    let config = Editor._projectProfile.data['facebook'];
    if (!config.enable) {
        cb && cb();
        return;
    }

    let progress = [];
    if (config.live.enable) {
        progress.push(live.handleLive(options));
    }

    if (config.audience.enable) {
        //progress.push(audience.handleAudience(options));
    }

    //不管处理成功失败，都调用回调，失败了在console打错误log就好了
    progress.length > 0 && Promise.all(progress).then(() => {
        cb && cb();
    }).catch(() => {
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
