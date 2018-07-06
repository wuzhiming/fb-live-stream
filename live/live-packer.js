/**
 * Created by wzm on 05/07/2018.
 */
const Path = require('fire-path');
const Fs = require('fire-fs');
const xml2js = require("xml2js");
const xcode = require('xcode');
const plist = require('plist');
/**
 * 添加 facebook live stream 的 sdk 到 android 工程
 * @param options
 * @returns {Promise}
 */
function _handleAndroid(options) {
    return new Promise((resolve, reject) => {
        let config = Editor._projectProfile.data['facebook'];
        //修改gradle.properties
        let gradlePropertyPath = Path.join(options.dest, 'frameworks/runtime-src/proj.android-studio/gradle.properties');
        if (Fs.existsSync(gradlePropertyPath)) {
            let content = Fs.readFileSync(gradlePropertyPath, 'utf-8');
            content = content.replace(/USE_FACEBOOK_SDK=.*/, `USE_FACEBOOK_SDK=true`);
            content = content.replace(/FACEBOOK_APP_ID=.*/, `FACEBOOK_APP_ID=fb${config.appID}`);
            Fs.writeFileSync(gradlePropertyPath, content);
        } else {
            Editor.error('cant find gradle.properties at ', gradlePropertyPath);
            reject();
            return;
        }

        //修改manifest文件
        let manifestPath = Path.join(options.dest, 'frameworks/runtime-src/proj.android-studio/app/AndroidManifest.xml');
        if (Fs.existsSync(manifestPath)) {
            let parser = new xml2js.Parser();

            let xml = Fs.readFileSync(manifestPath, 'utf-8');

            parser.options.explicitArray = false;
            xml = parser.parseString(xml, (err, data) => {
                if (err) {
                    Editor.error('parse AndroidManifest.xml fail');
                    reject();
                    return;
                }
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

                //加入的配置要考虑多种情况
                let replaceApplicationConfig = function (key, addData) {
                    let mData = data.manifest.application[key];
                    if (!mData) {
                        data.manifest.application[key] = addData
                    } else {
                        //如果存在了这个配置，就直接返回
                        let strData = JSON.stringify(mData);
                        if (strData.indexOf(addData.$['android:name']) != -1) return;

                        if (Array.isArray(mData)) {
                            mData.push(addData);
                        } else {
                            data.manifest.application[key] = [mData, addData];
                        }
                    }
                };

                let modifyList = [
                    {key: 'meta-data', data: fbMetaData},
                    {key: 'receiver', data: fbReceiver},
                ];

                modifyList.forEach((item) => {
                    replaceApplicationConfig(item.key, item.data);
                });

                let builder = new xml2js.Builder();
                Fs.writeFileSync(manifestPath, builder.buildObject(data));

                let libPath = Path.join(options.dest, 'frameworks/runtime-src/proj.android-studio/app/libs');
                let srcLibPath = Editor.url('packages://fb-live-stream/live/libs/android');

                Fs.copySync(srcLibPath, libPath);
                resolve();
            });

        } else {
            Editor.error('cant find AndroidManifest.xml file at ', manifestPath);
            reject();
        }
    });
}

/**
 * 添加 facebook live stream 的 sdk 到 iOS 工程
 * @param options
 * @returns {Promise}
 */
function _handleIOS(options) {
    return new Promise((resolve, reject) => {
        let config = Editor._projectProfile.data['facebook'];
        //第一步，拷贝framework
        let libPath = Path.join(options.dest, 'frameworks/runtime-src/proj.ios_mac/frameworks');
        let srcLibPath = Editor.url('packages://fb-live-stream/live/libs/ios');
        Fs.copySync(srcLibPath, libPath);

        //第二步，为工程添加framework索引
        let projectPath = Path.join(options.dest, `frameworks/runtime-src/proj.ios_mac/${options.projectName}.xcodeproj/project.pbxproj`);
        if (!Fs.existsSync(projectPath)) {
            Editor.error('Can\'t find xcodeproj file at path: ', projectPath);
            reject();
            return;
        }
        let project = xcode.project(projectPath);
        project.parseSync();

        let section = project.pbxNativeTargetSection();
        let targetName = `${options.projectName}-mobile`;
        let target = null;

        //先找下有没有默认的target
        for (let k in section) {
            let item = section[k];
            if (typeof item === 'string') continue;
            if (item.name === targetName) {
                target = k;
                break;
            }
        }

        //没有的话尝试找一下mobile的
        if (target == null) {
            for (let k in section) {
                let item = section[k];
                if (typeof item === 'string') continue;
                if (item.name && item.name.indexOf('mobile') !== -1) {
                    target = k;
                    break;
                }
            }
        }

        //如果依然找不到要build的target那么让用户自己去添加吧
        if (!target) {
            Editor.error('Can\'t find project target: ', targetName, 'add link libraries failed , you can add link libraries at Xcode');
        }

        project.addFramework('frameworks/Bolts.framework', {
            customFramework: true,
            target: target,
            embed: true
        });
        project.addFramework('frameworks/FBSDKCoreKit.framework', {
            customFramework: true,
            target: target,
            embed: true
        });
        project.addFramework('frameworks/FBSDKLiveStreamingKit.framework', {
            customFramework: true,
            target: target,
            embed: true
        });
        Fs.writeFileSync(projectPath, project.writeSync());

        //第三步，修改info.plist加入fbid
        let infoListPath = Path.join(options.dest, 'frameworks/runtime-src/proj.ios_mac/ios/Info.plist');
        if (!Fs.existsSync(infoListPath)) {
            reject();
            Editor.error('Can\'t find Info.plist file at path: ', infoListPath);
            return;
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
        resolve();
    });
}

function handleLive(options) {
    let handle;
    if (options.actualPlatform === 'Android') {
        handle = _handleAndroid(options);
    } else if (options.actualPlatform === "iOS") {
        handle = _handleIOS(options);
    } else {
        handle = Promise.resolve();
    }
    return handle;
}

module.exports = {
    handleLive: handleLive,
};