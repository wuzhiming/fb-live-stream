'use strict';
const Path = require('fire-path');
const Fs = require('fire-fs');
const xml2js = require("xml2js");
const xcode = require('xcode');
const plist = require('plist');
const {android, ios} = Editor.require('app://editor/core/native-packer');
/**
 * 添加 facebook live stream 的 sdk 到 android 工程
 * @param options
 * @returns {Promise}
 */
async function _handleAndroid(options) {
    let config = Editor._projectProfile.data['facebook'];

    let androidPacker = new android(options);

    //修改gradle.properties
    let gradlePropertyPath = Path.join(options.dest, 'frameworks/runtime-src/proj.android-studio/gradle.properties');
    if (Fs.existsSync(gradlePropertyPath)) {
        let content = Fs.readFileSync(gradlePropertyPath, 'utf-8');
        content = content.replace(/FACEBOOK_APP_ID=.*/, `FACEBOOK_APP_ID=fb${config.appID}`);
        Fs.writeFileSync(gradlePropertyPath, content);
    } else {
        Editor.error('cant find gradle.properties at ', gradlePropertyPath);
        return Promise.reject();
    }

    //修改build.gradle文件
    androidPacker.addDependence('com.facebook.android:facebook-login', '4.+');

    let buildGradle = Path.join(options.dest, 'frameworks/runtime-src/proj.android-studio/app/build.gradle');
    if (Fs.existsSync(buildGradle)) {
        let content = Fs.readFileSync(buildGradle, 'utf-8');
        if (content.indexOf('android.defaultConfig.manifestPlaceholders') == -1) {
            content += "\nandroid.defaultConfig.manifestPlaceholders = [facebookAppId:FACEBOOK_APP_ID]";
        }

        Fs.writeFileSync(buildGradle, content);
    } else {
        Editor.error('cant find build.gradle at ', buildGradle);
        return Promise.reject();
    }

    //添加aar文件
    let srcLibPath = Editor.url('packages://fb-live-stream/libs/android/facebook-livestream.aar');
    androidPacker.addLib(srcLibPath);

    //拷贝android文件
    let srcAndroidPath = Editor.url('packages://fb-live-stream/libs/android');
    let destAndroidPath = Path.join(options.dest, 'frameworks/runtime-src/proj.android-studio/app/src/org/cocos2dx/javascript');

    let fileList = ['FacebookLive.java'];
    fileList.forEach((file) => {
        androidPacker.ensureFile(Path.join(srcAndroidPath, file), Path.join(destAndroidPath, file));
    });

    //首先加载一下AndroidManifest.xml(异步)
    await androidPacker.readAndroidManifest().catch((e)=>{
        Editor.log("read AndroidManifest.xml fail ", e);
    });

    let fbMetaData = {
        "$": {"android:name": "com.facebook.sdk.ApplicationId", "android:value": "${facebookAppId}"}
    };

    let fbReceiver = {
        "$": {
            "android:name": "com.facebook.livestreaming.LiveStreamBroadcastReceiver",
            "android:exported": true
        },
        "intent-filter": {
            "action": [
                {"$": {"android:name": "com.facebook.livestreaming.status"}},
                {"$": {"android:name": "com.facebook.livestreaming.error"}}]
        }
    };

    let modifyList = [
        {key: 'meta-data', data: fbMetaData},
        {key: 'receiver', data: fbReceiver},
    ];

    modifyList.forEach((item) => {
        androidPacker.addManifestApplicationConfig(item.key, item.data);
    });

    //拷贝js资源，并加入require
    _copyFsupportFile(options, androidPacker);
}

/**
 * android 和iOS 共用的资源拷贝
 * @param options
 * @param packer
 * @private
 */
function _copyFsupportFile(options, packer) {
    //拷贝脚本文件
    let srcJsPath = Editor.url('packages://fb-live-stream/libs/js');
    let destJsPath = Path.join(options.dest, 'src');
    Fs.copySync(srcJsPath, destJsPath);

    packer.addRequireToMainJs("src/fb-live-stream.js");
}

/**
 * 添加 facebook live stream 的 sdk 到 iOS 工程
 * @param options
 * @returns {Promise}
 */
async function _handleIOS(options) {
    let config = Editor._projectProfile.data['facebook'];

    let iosPacker = new ios(options);

    //第一步，拷贝framework
    let libPath = Path.join(options.dest, 'frameworks/runtime-src/proj.ios_mac/frameworks');
    let srcLibPath = Editor.url('packages://fb-live-stream/libs/ios/framework');
    iosPacker.ensureFile(srcLibPath, libPath);

    //第二步，为工程添加framework索引
    let projectPath = Path.join(options.dest, `frameworks/runtime-src/proj.ios_mac/${options.projectName}.xcodeproj/project.pbxproj`);
    if (!Fs.existsSync(projectPath)) {
        Editor.error('Can\'t find xcodeproj file at path: ', projectPath);
        return Promise.reject();
    }

    let targetName = `${options.projectName}-mobile`;

    iosPacker.addFramework('frameworks/Bolts.framework', targetName);
    iosPacker.addFramework('frameworks/FBSDKCoreKit.framework', targetName);
    iosPacker.addFramework('frameworks/FBSDKLiveStreamingKit.framework', targetName);


    //第三步，修改info.plist加入fbid
    let infoListPath = Path.join(options.dest, 'frameworks/runtime-src/proj.ios_mac/ios/Info.plist');
    if (!Fs.existsSync(infoListPath)) {
        Editor.error('Can\'t find Info.plist file at path: ', infoListPath);
        return Promise.reject();
    }

    let data = Fs.readFileSync(infoListPath, 'utf-8');
    let parseData = plist.parse(data);
    parseData.FacebookAppID = config.appID;

    if (!parseData.FacebookDisplayName) {
        parseData.FacebookDisplayName = options.projectName;
    }

    if (!parseData.NSCameraUsageDescription) {
        parseData.NSCameraUsageDescription = 'The camera will show the player during the live stream.';
    }

    if (!parseData.NSMicrophoneUsageDescription) {
        parseData.NSMicrophoneUsageDescription = 'The microphone will record the player\'s voice during the live stream.';
    }

    if (!parseData.LSApplicationQueriesSchemes) {
        parseData.LSApplicationQueriesSchemes = ["fbapi", "fb-messenger-share-api", "fbauth2", "fbshareextension", "fb-broadcastextension"];
    }

    let urlTemplate = {
        "CFBundleTypeRole": "Editor",
        "CFBundleURLName": "",
        "CFBundleURLSchemes": [`fb${config.appID}`]
    };

    if (!parseData.CFBundleURLTypes) {
        parseData.CFBundleURLTypes = [urlTemplate];
    } else if (JSON.stringify(parseData.CFBundleURLTypes).indexOf(`fb${config.appID}`) == -1) {
        parseData.CFBundleURLTypes.push(urlTemplate);
    }

    Fs.writeFileSync(infoListPath, plist.build(parseData));

    //第四步，修改 添加FacebookLive.mm ，加入 Live Stream 的引用
    let srcSupportPath = Editor.url('packages://fb-live-stream/libs/ios/support');
    let destSupportPath = Path.join(options.dest, 'frameworks/runtime-src/proj.ios_mac/ios');
    let fileList = ['FacebookLive.mm', 'FacebookLive.h'];
    fileList.forEach((file) => {
        iosPacker.ensureFile(Path.join(srcSupportPath, file), Path.join(destSupportPath, file));
    });

    //加入Facebook文件的引用
    iosPacker.addFileToProject('ios/FacebookLive.h', 'ios');
    iosPacker.addFileToCompileSource('ios/FacebookLive.mm', `${options.projectName}-mobile`, 'ios');

    //第五步，拷贝js资源，并加入require
    _copyFsupportFile(options, iosPacker);
}

async function handleFiles(options, cb) {
    let config = Editor._projectProfile.data['facebook'];
    if (!config.enable || !config.live.enable) {
        cb && cb();
        return;
    }

    if (options.actualPlatform.toLowerCase() === 'android') {
        await _handleAndroid(options).catch((e) => {
            Editor.log("Some error have occurred while adding Facebook Live Stream Android SDK ");
        });
    } else if (options.actualPlatform.toLowerCase() === "ios") {
        await _handleIOS(options).catch((e) => {
            Editor.log("Some error have occurred while adding Facebook Live Stream iOS SDK ");
        });
    }
    cb && cb();
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
