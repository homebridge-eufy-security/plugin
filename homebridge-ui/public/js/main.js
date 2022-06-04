var pluginConfig = {
    platform: 'EufySecurity',
};

var isCamera = ['CAMERA', 'CAMERA2', 'CAMERA_E', 'CAMERA2C', 'INDOOR_CAMERA', 'INDOOR_PT_CAMERA', 'FLOODLIGHT', 'DOORBELL', 'BATTERY_DOORBELL', 'BATTERY_DOORBELL_2', 'CAMERA2C_PRO', 'CAMERA2_PRO', 'INDOOR_CAMERA_1080', 'INDOOR_PT_CAMERA_1080', 'SOLO_CAMERA', 'SOLO_CAMERA_PRO', 'SOLO_CAMERA_SPOTLIGHT_1080', 'SOLO_CAMERA_SPOTLIGHT_2K', 'SOLO_CAMERA_SPOTLIGHT_SOLAR', 'INDOOR_OUTDOOR_CAMERA_1080P', 'INDOOR_OUTDOOR_CAMERA_1080P_NO_LIGHT', 'INDOOR_OUTDOOR_CAMERA_2K', 'FLOODLIGHT_CAMERA_8422', 'FLOODLIGHT_CAMERA_8423', 'FLOODLIGHT_CAMERA_8424', 'BATTERY_DOORBELL_PLUS', 'DOORBELL_SOLO'];
var isDoorBell = ['DOORBELL', 'BATTERY_DOORBELL', 'BATTERY_DOORBELL_2', 'BATTERY_DOORBELL_PLUS', 'DOORBELL_SOLO'];

var EufyPluginConfig = {
    "username": '',
    "password": '',
    "pollingIntervalMinutes": 30,
    "hkHome": 1,
    "hkAway": 0,
    "hkNight": 3,
    "hkOff": 63,
    "enableDetailedLogging": false,
    "ignoreStations": [],
    "ignoreDevices": [],
    "country": 'US',
    "CameraMaxLivestreamDuration": 30,
    "cleanCache": true
}

var CameraConfig = {
    "enableCamera": false,
    "enableButton": true,
    "motionButton": true,
    "rtsp": true,
    "unbridge": true,
    "forcerefreshsnap": false,
    "useCachedLocalLivestream": false,
    "useEnhancedSnapshotBehaviour": true,
    "refreshSnapshotIntervalMinutes": 0,
    "snapshotHandlingMethod": 0,
    "immediateRingNotificationWithoutSnapshot": false,
    "videoConfig": {
        "debug": false,
        "audio": true,
        "readRate": false,
        "forceMax": false,
        "vcodec": '',
        "acodec": '',
        "videoFilter": '',
        "encoderOptions": '',
        "probeSize": 0,
        "analyzeDuration": 0,
        "mapvideo": '',
        "mapaudio": '',
        "maxDelay": 0,
        "maxStreams": 0,
        "maxWidth": 0,
        "maxHeight": 0,
        "maxFPS": 0,
        "maxBitrate": 0,
    }
}

var countries = {
    "AF": "Afghanistan",
    "AX": "Aland Islands",
    "AL": "Albania",
    "DZ": "Algeria",
    "AS": "American Samoa",
    "AD": "Andorra",
    "AO": "Angola",
    "AI": "Anguilla",
    "AQ": "Antarctica",
    "AG": "Antigua and Barbuda",
    "AR": "Argentina",
    "AM": "Armenia",
    "AW": "Aruba",
    "AU": "Australia",
    "AT": "Austria",
    "AZ": "Azerbaijan",
    "BS": "Bahamas",
    "BH": "Bahrain",
    "BD": "Bangladesh",
    "BB": "Barbados",
    "BY": "Belarus",
    "BE": "Belgium",
    "BZ": "Belize",
    "BJ": "Benin",
    "BM": "Bermuda",
    "BT": "Bhutan",
    "BO": "Bolivia",
    "BQ": "Bonaire, Sint Eustatius and Saba",
    "BA": "Bosnia and Herzegovina",
    "BW": "Botswana",
    "BV": "Bouvet Island",
    "BR": "Brazil",
    "IO": "British Indian Ocean Territory",
    "BN": "Brunei Darussalam",
    "BG": "Bulgaria",
    "BF": "Burkina Faso",
    "BI": "Burundi",
    "KH": "Cambodia",
    "CM": "Cameroon",
    "CA": "Canada",
    "CV": "Cape Verde",
    "KY": "Cayman Islands",
    "CF": "Central African Republic",
    "TD": "Chad",
    "CL": "Chile",
    "CN": "China",
    "CX": "Christmas Island",
    "CC": "Cocos (Keeling) Islands",
    "CO": "Colombia",
    "KM": "Comoros",
    "CG": "Congo",
    "CD": "Congo, the Democratic Republic of the",
    "CK": "Cook Islands",
    "CR": "Costa Rica",
    "CI": "Cote D'Ivoire",
    "HR": "Croatia",
    "CU": "Cuba",
    "CW": "Curacao",
    "CY": "Cyprus",
    "CZ": "Czech Republic",
    "DK": "Denmark",
    "DJ": "Djibouti",
    "DM": "Dominica",
    "DO": "Dominican Republic",
    "EC": "Ecuador",
    "EG": "Egypt",
    "SV": "El Salvador",
    "GQ": "Equatorial Guinea",
    "ER": "Eritrea",
    "EE": "Estonia",
    "ET": "Ethiopia",
    "FK": "Falkland Islands (Malvinas)",
    "FO": "Faroe Islands",
    "FJ": "Fiji",
    "FI": "Finland",
    "FR": "France",
    "GF": "French Guiana",
    "PF": "French Polynesia",
    "TF": "French Southern Territories",
    "GA": "Gabon",
    "GM": "Gambia",
    "GE": "Georgia",
    "DE": "Germany",
    "GH": "Ghana",
    "GI": "Gibraltar",
    "GR": "Greece",
    "GL": "Greenland",
    "GD": "Grenada",
    "GP": "Guadeloupe",
    "GU": "Guam",
    "GT": "Guatemala",
    "GG": "Guernsey",
    "GN": "Guinea",
    "GW": "Guinea-Bissau",
    "GY": "Guyana",
    "HT": "Haiti",
    "HM": "Heard Island and Mcdonald Islands",
    "VA": "Holy See (Vatican City State)",
    "HN": "Honduras",
    "HK": "Hong Kong",
    "HU": "Hungary",
    "IS": "Iceland",
    "IN": "India",
    "ID": "Indonesia",
    "IR": "Iran, Islamic Republic of",
    "IQ": "Iraq",
    "IE": "Ireland",
    "IM": "Isle of Man",
    "IL": "Israel",
    "IT": "Italy",
    "JM": "Jamaica",
    "JP": "Japan",
    "JE": "Jersey",
    "JO": "Jordan",
    "KZ": "Kazakhstan",
    "KE": "Kenya",
    "KI": "Kiribati",
    "KP": "Korea, Democratic People's Republic of",
    "KR": "Korea, Republic of",
    "XK": "Kosovo",
    "KW": "Kuwait",
    "KG": "Kyrgyzstan",
    "LA": "Lao People's Democratic Republic",
    "LV": "Latvia",
    "LB": "Lebanon",
    "LS": "Lesotho",
    "LR": "Liberia",
    "LY": "Libyan Arab Jamahiriya",
    "LI": "Liechtenstein",
    "LT": "Lithuania",
    "LU": "Luxembourg",
    "MO": "Macao",
    "MK": "Macedonia, the Former Yugoslav Republic of",
    "MG": "Madagascar",
    "MW": "Malawi",
    "MY": "Malaysia",
    "MV": "Maldives",
    "ML": "Mali",
    "MT": "Malta",
    "MH": "Marshall Islands",
    "MQ": "Martinique",
    "MR": "Mauritania",
    "MU": "Mauritius",
    "YT": "Mayotte",
    "MX": "Mexico",
    "FM": "Micronesia, Federated States of",
    "MD": "Moldova, Republic of",
    "MC": "Monaco",
    "MN": "Mongolia",
    "ME": "Montenegro",
    "MS": "Montserrat",
    "MA": "Morocco",
    "MZ": "Mozambique",
    "MM": "Myanmar",
    "NA": "Namibia",
    "NR": "Nauru",
    "NP": "Nepal",
    "NL": "Netherlands",
    "AN": "Netherlands Antilles",
    "NC": "New Caledonia",
    "NZ": "New Zealand",
    "NI": "Nicaragua",
    "NE": "Niger",
    "NG": "Nigeria",
    "NU": "Niue",
    "NF": "Norfolk Island",
    "MP": "Northern Mariana Islands",
    "NO": "Norway",
    "OM": "Oman",
    "PK": "Pakistan",
    "PW": "Palau",
    "PS": "Palestinian Territory, Occupied",
    "PA": "Panama",
    "PG": "Papua New Guinea",
    "PY": "Paraguay",
    "PE": "Peru",
    "PH": "Philippines",
    "PN": "Pitcairn",
    "PL": "Poland",
    "PT": "Portugal",
    "PR": "Puerto Rico",
    "QA": "Qatar",
    "RE": "Reunion",
    "RO": "Romania",
    "RU": "Russian Federation",
    "RW": "Rwanda",
    "BL": "Saint Barthelemy",
    "SH": "Saint Helena",
    "KN": "Saint Kitts and Nevis",
    "LC": "Saint Lucia",
    "MF": "Saint Martin",
    "PM": "Saint Pierre and Miquelon",
    "VC": "Saint Vincent and the Grenadines",
    "WS": "Samoa",
    "SM": "San Marino",
    "ST": "Sao Tome and Principe",
    "SA": "Saudi Arabia",
    "SN": "Senegal",
    "RS": "Serbia",
    "CS": "Serbia and Montenegro",
    "SC": "Seychelles",
    "SL": "Sierra Leone",
    "SG": "Singapore",
    "SX": "Sint Maarten",
    "SK": "Slovakia",
    "SI": "Slovenia",
    "SB": "Solomon Islands",
    "SO": "Somalia",
    "ZA": "South Africa",
    "GS": "South Georgia and the South Sandwich Islands",
    "SS": "South Sudan",
    "ES": "Spain",
    "LK": "Sri Lanka",
    "SD": "Sudan",
    "SR": "Suriname",
    "SJ": "Svalbard and Jan Mayen",
    "SZ": "Swaziland",
    "SE": "Sweden",
    "CH": "Switzerland",
    "SY": "Syrian Arab Republic",
    "TW": "Taiwan, Province of China",
    "TJ": "Tajikistan",
    "TZ": "Tanzania, United Republic of",
    "TH": "Thailand",
    "TL": "Timor-Leste",
    "TG": "Togo",
    "TK": "Tokelau",
    "TO": "Tonga",
    "TT": "Trinidad and Tobago",
    "TN": "Tunisia",
    "TR": "Turk",
    "TM": "Turkmenistan",
    "TC": "Turks and Caicos Islands",
    "TV": "Tuvalu",
    "UG": "Uganda",
    "UA": "Ukraine",
    "AE": "United Arab Emirates",
    "GB": "United Kingdom",
    "US": "United States",
    "UM": "United States Minor Outlying Islands",
    "UY": "Uruguay",
    "UZ": "Uzbekistan",
    "VU": "Vanuatu",
    "VE": "Venezuela",
    "VN": "Viet Nam",
    "VG": "Virgin Islands, British",
    "VI": "Virgin Islands, U.s.",
    "WF": "Wallis and Futuna",
    "EH": "Western Sahara",
    "YE": "Yemen",
    "ZM": "Zambia",
    "ZW": "Zimbabwe"
};

function generate_country_selector(id) {
    let option = '';
    Object.entries(countries).forEach(([k, v]) => {
        option += '<option value="' + k + '">' + v + '</option>';
    });
    document.getElementById(id).innerHTML = option;
}

async function hb_request(url, params) {
    homebridge.showSpinner();
    const c = await homebridge.request(url, params);
    homebridge.hideSpinner();
    return c;
}

function updateFormFromConfig() {

    const c = { ...EufyPluginConfig, ...pluginConfig };
    const i = ['cameras', 'platform'];

    Object.entries(c).forEach(([k, v]) => {
        if (i.includes(k)) return;
        if (typeof EufyPluginConfig[k] === 'boolean') document.getElementById('epc-' + k).checked = v;
        if (typeof EufyPluginConfig[k] === 'number') document.getElementById('epc-' + k).value = v;
        if (typeof EufyPluginConfig[k] === 'string') document.getElementById('epc-' + k).value = v;
    });

    document.getElementById('usernameInput1').value = c.username;
    document.getElementById('passwordInput1').value = c.password;
    document.getElementById('countryInput1').value = c.country;

    homebridge.fixScrollHeight();
}

function updateConfigFromForm() {
    const i = ['cameras', 'platform'];
    Object.entries(EufyPluginConfig).forEach(([k, v]) => {
        if (i.includes(k)) return;
        if (typeof EufyPluginConfig[k] === 'boolean') pluginConfig[k] = document.getElementById('epc-' + k).checked;
        if (typeof EufyPluginConfig[k] === 'number') pluginConfig[k] = parseInt(document.getElementById('epc-' + k).value);
        if (typeof EufyPluginConfig[k] === 'string') pluginConfig[k] = document.getElementById('epc-' + k).value;
    });
}

async function AddOrRemoveStationsIgnoreList(item) {
    pluginConfig.ignoreStations.indexOf(item) === -1 ? pluginConfig.ignoreStations.push(item) : pluginConfig.ignoreStations.splice(pluginConfig.ignoreStations.indexOf(item), 1);
    document.getElementById('epc-ignoreStations').value = pluginConfig.ignoreStations.toString();
    await homebridge.updatePluginConfig([pluginConfig]);
}

async function AddOrRemoveDevicesIgnoreList(item) {
    pluginConfig.ignoreDevices.indexOf(item) === -1 ? pluginConfig.ignoreDevices.push(item) : pluginConfig.ignoreDevices.splice(pluginConfig.ignoreDevices.indexOf(item), 1);
    document.getElementById('epc-ignoreDevices').value = pluginConfig.ignoreDevices.toString();
    await homebridge.updatePluginConfig([pluginConfig]);
}

function isStationsIgnored(uniqueId) {
    const r = pluginConfig.ignoreStations.find((o, i, a) => {
        return (uniqueId === o) ? true : false;
    });
    return (r) ? true : false;
}

function isDevicesIgnored(uniqueId) {
    const r = pluginConfig.ignoreDevices.find((o, i, a) => {
        return (uniqueId === o) ? true : false;
    });
    return (r) ? true : false;
}

async function list_stations_devices(stations) {

    const s_div = document.getElementById('stations');

    display_box('step3');

    if (!stations.length) {
        s_div.innerHTML = '<span style="color:red; font-weight:bold;">Error: Nothing have been retreived!</span>';
        return;
    }

    pluginConfig.username = document.getElementById('usernameInput1').value;
    pluginConfig.password = document.getElementById('passwordInput1').value;
    pluginConfig.country = document.getElementById('countryInput1').value;
    document.getElementById('epc-username').value = document.getElementById('usernameInput1').value;
    document.getElementById('epc-password').value = document.getElementById('passwordInput1').value;
    document.getElementById('epc-country').value = document.getElementById('countryInput1').value;

    pluginConfig.ignoreStations = (typeof pluginConfig.ignoreStations === 'object') ? pluginConfig.ignoreStations : [];
    pluginConfig.ignoreDevices = (typeof pluginConfig.ignoreDevices === 'object') ? pluginConfig.ignoreDevices : [];

    await homebridge.updatePluginConfig([pluginConfig]);

    document.getElementById('list_body').innerHTML = '';

    stations.forEach(function (s_item) {

        const checked = (isStationsIgnored(s_item.uniqueId)) ? ' checked' : '';

        var r1 = document.createElement("div");

        r1.setAttribute('class', 'divTableRow' + checked);

        r1.innerHTML = `
                    <div class="divTableCell">${s_item.displayName}</div>
                    <div class="divTableCell">${s_item.uniqueId}</div>
                    <div class="divTableCell">${s_item.type}</div>
                    <div class="divTableCell"><input type="checkbox" class="ignore_stations" id="st_${s_item.uniqueId}" name="${s_item.uniqueId}"${checked} /></div>
                `;
        document.getElementById('list_body').appendChild(r1);

        s_item.devices.forEach(function (item) {

            if (item.ignore) {
                AddOrRemoveDevicesIgnoreList(item.uniqueId);
            }
            var r2 = document.createElement("div");
            const checked = (isDevicesIgnored(item.uniqueId)) ? ' checked' : '';
            r2.setAttribute('class', 'divTableRow' + checked);
            r2.innerHTML = `
                    <div class="divTableCell">|--&nbsp;${item.displayName}</div>
                    `;
            if (isCamera.includes(item.type)) {
                r2.innerHTML += `
                    <div class="divTableCell"><a href="javascript:void(0)" id="conf_d_${item.uniqueId}">${item.uniqueId}</a></div>
                    `;
            } else {
                r2.innerHTML += `
                    <div class="divTableCell">${item.uniqueId}</div>
                    `;
            }
            r2.innerHTML += `
                    <div class="divTableCell">${item.type}</div>
                    <div class="divTableCell"><input type="checkbox" class="ignore_devices" id="ds_${item.uniqueId}" name="${item.uniqueId}"${checked} /></div>
                `;
            document.getElementById('list_body').appendChild(r2);
        });
    });

    let st = 0;

    stations.forEach(function (s_item) {

        let ds = 0;
        let st_ele = document.getElementById(`st_${s_item.uniqueId}`);

        st_ele.addEventListener('change', async e => {
            if (e.target.checked) {
                st_ele.parentElement.parentElement.classList.add('checked');
            } else {
                st_ele.parentElement.parentElement.classList.remove('checked');
            }
            console.log(s_item.uniqueId);
            await AddOrRemoveStationsIgnoreList(s_item.uniqueId);
        });

        s_item.devices.forEach(function (item) {
            let ds_ele = document.getElementById(`ds_${item.uniqueId}`);

            ds_ele.addEventListener('change', async e => {
                if (e.target.checked) {
                    ds_ele.parentElement.parentElement.classList.add('checked');
                } else {
                    ds_ele.parentElement.parentElement.classList.remove('checked');
                }
                console.log(s_item.uniqueId);
                await AddOrRemoveDevicesIgnoreList(item.uniqueId);
            });
            if (isCamera.includes(item.type)) {
                this[item.uniqueId] = stations[st].devices[ds];
                document.getElementById(`conf_d_${item.uniqueId}`).addEventListener('click', async e => {
                    ConfigCameraFill(this[item.uniqueId]);
                });
            }
            ds++;
        });
        st++;

    });
}

function display_box(display) {
    const bloc_main = ['setupComplete', 'setupRequired', 'reset-box', 'camera-config-box'];
    const bloc_setup = ['step1', 'step2-captcha', 'step2-otp', 'step3'];

    bloc_main.forEach(e => {
        document.getElementById(e).style.display = (e === display) ? 'block' : 'none';
    });

    bloc_setup.forEach(e => {
        if (e === display) {
            document.getElementById('setupRequired').style.display = 'block';
        }
        document.getElementById(e).style.display = (e === display) ? 'block' : 'none';
    });

}

async function getStations(refresh = false) {
    try {

        homebridge.toast.info('Getting Devices....');
        const response = await hb_request('/getStations', { 'refresh': refresh });

        await list_stations_devices(response.stations);
    } catch (e) {

        homebridge.toast.error(e.message, 'Error');
    }
}

function getConfigCamera(uniqueId) {

    if (!pluginConfig.cameras) pluginConfig.cameras = [];

    var pos = pluginConfig.cameras.map(function (e) { return e.serialNumber; }).indexOf(uniqueId);

    if (pos === -1) {
        return CameraConfig;
    }

    var d = pluginConfig.cameras[pos];
    var c = CameraConfig;

    d.videoConfig = { ...CameraConfig.videoConfig, ...pluginConfig.cameras[pos].videoConfig };
    return { ...c, ...d };
}

function ConfigCameraFill(camera) {

    var config = getConfigCamera(camera.uniqueId);

    if (!config.snapshotHandlingMethod) {
        config.snapshotHandlingMethod = (config.forcerefreshsnap) ? 1 : 3;
    }

    document.getElementById('cc-name').value = camera.displayName;
    document.getElementById('cc-serialnumber').value = camera.uniqueId;

    Object.entries(config).forEach(([k, v]) => {
        if (typeof config[k] === 'boolean') {
            if (document.getElementById('cc-' + k)) document.getElementById('cc-' + k).checked = v;
        }
        if (typeof config[k] === 'number' && document.getElementById('cc-' + k)) {
            if (v !== 0) {
                document.getElementById('cc-' + k).classList.remove('disabled');
                document.getElementById('cc-' + k + '-ena').checked = true;
            }
            document.getElementById('cc-' + k).value = v;
        }
    });

    Object.entries(config.videoConfig).forEach(([k, v]) => {
        if (typeof config.videoConfig[k] === 'boolean') {
            document.getElementById('cc-videoConfig-' + k).checked = v;
        }
        if (typeof CameraConfig.videoConfig[k] === 'number') {
            if (v !== 0) {
                document.getElementById('cc-videoConfig-' + k).classList.remove('disabled');
                document.getElementById('cc-videoConfig-' + k + '-ena').checked = true;
            }
            document.getElementById('cc-videoConfig-' + k).value = v;
        }
        if (typeof config.videoConfig[k] === 'string') {
            if (v !== '') {
                document.getElementById('cc-videoConfig-' + k).classList.remove('disabled');
                document.getElementById('cc-videoConfig-' + k + '-ena').checked = true;
            }
            document.getElementById('cc-videoConfig-' + k).value = v;
        }
    });

    const ecf = document.getElementById('cc-enableCamera-btn-false');
    const ect = document.getElementById('cc-enableCamera-btn-true');

    if (isDoorBell.includes(camera.type)) {
        config.enableCamera = true;
        ecf.parentElement.classList.add('disabled');
    } else {
        ecf.parentElement.classList.remove('disabled');
    }

    ecf.checked = !config.enableCamera;
    ect.checked = config.enableCamera;

    if (config.enableCamera) {
        ecf.parentElement.classList.remove('active');
        ect.parentElement.classList.add('active');
    } else {
        ecf.parentElement.classList.add('active');
        ect.parentElement.classList.remove('active');
    }

    const sh1 = document.getElementById('cc-snapshotHandlingMethod-btn-1');
    // const sh2 = document.getElementById('cc-snapshotHandlingMethod-btn-2');
    const sh3 = document.getElementById('cc-snapshotHandlingMethod-btn-3');

    switch (config.snapshotHandlingMethod) {
        case 1:
            sh1.checked = true;
            // sh2.checked = false;
            sh3.checked = false;
            sh1.parentElement.classList.add('active');
            // sh2.parentElement.classList.remove('active');
            sh3.parentElement.classList.remove('active'); 
        break;
        case 2:
            sh1.checked = false;
            // sh2.checked = true;
            sh3.checked = false;
            sh1.parentElement.classList.remove('active');
            // sh2.parentElement.classList.add('active');
            sh3.parentElement.classList.remove('active'); 
        break;
    
        default:
            sh1.checked = false;
            // sh2.checked = false;
            sh3.checked = true;
            sh1.parentElement.classList.remove('active');
            // sh2.parentElement.classList.remove('active');
            sh3.parentElement.classList.add('active'); 
            break;
    }


    document.getElementById('camera-adv').style.display = (config.enableCamera) ? 'block' : 'none';
    document.getElementById('camera-snapshot-enh').style.display = (config.useEnhancedSnapshotBehaviour) ? 'block' : 'none';
    document.getElementById('camera-snapshot-old').style.display = (!config.useEnhancedSnapshotBehaviour) ? 'block' : 'none';

    display_box('camera-config-box');
}

async function save_camera_config() {
    var c = { ...{ serialNumber: '' } };

    c['serialNumber'] = document.getElementById('cc-serialnumber').value;

    Object.entries(CameraConfig).forEach(([k, v]) => {
        const vc = document.getElementById('cc-' + k);
        if (typeof CameraConfig[k] === 'boolean') c[k] = vc.checked;

        if (typeof CameraConfig[k] === 'number' && document.getElementById('cc-' + k))
            if (document.getElementById('cc-' + k + '-ena').checked)
                c[k] = parseInt(vc.value);
    });

    c.videoConfig = {};

    Object.entries(CameraConfig.videoConfig).forEach(([k, v]) => {
        const vc = document.getElementById('cc-videoConfig-' + k);

        if (typeof CameraConfig.videoConfig[k] === 'boolean')
            if (vc.checked)
                c.videoConfig[k] = vc.checked;

        if (typeof CameraConfig.videoConfig[k] === 'number')
            if (document.getElementById('cc-videoConfig-' + k + '-ena').checked)
                c.videoConfig[k] = parseInt(vc.value);

        if (typeof CameraConfig.videoConfig[k] === 'string')
            if (document.getElementById('cc-videoConfig-' + k + '-ena').checked)
                c.videoConfig[k] = vc.value;

    });

    if (!pluginConfig.cameras) pluginConfig.cameras = [];

    var pos = pluginConfig.cameras.map(function (e) { return e.serialNumber; }).indexOf(c['serialNumber']);

    if (pos === -1) pluginConfig.cameras.push(c);

    pluginConfig.cameras[pos] = c;

    await homebridge.updatePluginConfig([pluginConfig]);
    await homebridge.savePluginConfig();
}

async function whatsnext(url, params) {
    const response = await hb_request(url, params);

    switch (response.result) {
        case 1:
            display_box('step2-captcha');
            break;
        case 2:
            display_box('step2-otp');
            break;
        case 3:
            await getStations(true);
            break;
        default:
            homebridge.toast.error("Wrong!");
    }

}

// watch for changes to the config form
document.getElementById('configForm').addEventListener('change', async () => {
    // extract the values from the form - stored in var pluginConfig.
    updateConfigFromForm();

    // send the current value to the UI.
    await homebridge.updatePluginConfig([pluginConfig]);
});

// step 1 submit handler
document.getElementById('advanced').addEventListener('click', async (e) => {
    const expandable = document.getElementById('expandable');

    if (expandable.classList.contains('hidden')) {
        expandable.classList.remove('hidden')
        e.target.getElementsByTagName('i')[0].classList.remove('fa-chevron-right')
        e.target.getElementsByTagName('i')[0].classList.add('fa-chevron-down')
    } else {
        expandable.classList.add('hidden')
        e.target.getElementsByTagName('i')[0].classList.add('fa-chevron-right')
        e.target.getElementsByTagName('i')[0].classList.remove('fa-chevron-down')
    }
});


document.querySelectorAll('.skip').forEach(item => {
    item.addEventListener('click', event => {
        display_box('setupComplete');
    })
});

// startOver
document.getElementById('startOver').addEventListener('click', async () => {
    display_box('step1');
});

// list-devices
document.getElementById('listDevices').addEventListener('click', async () => {
    await getStations();
});

// list-devices
document.getElementById('skip-camera-config').addEventListener('click', async () => {
    await getStations();
});

// Reset
document.getElementById('reset').addEventListener('click', async () => {
    display_box('reset-box');
});

// step 1 submit handler
document.querySelectorAll('.startover').forEach(item => {
    item.addEventListener('click', async event => {

        const usernameValue = document.getElementById('usernameInput1').value;
        const passwordValue = document.getElementById('passwordInput1').value;
        const countryValue = document.getElementById('countryInput1').value;

        if (!usernameValue || !passwordValue) {
            homebridge.toast.error('Please enter your username and password.', 'Error');
            return;
        }

        try {
            whatsnext('/auth', { username: usernameValue, password: passwordValue, country: countryValue });
        } catch (e) {
            homebridge.toast.error(e.message, 'Error');
        }
    })
});

document.getElementById('confirm-camera-config').addEventListener('click', async () => {
    save_camera_config();
});

// step 2 captcha submit handler
document.getElementById('step2-captcha-Submit').addEventListener('click', async () => {

    const captchaInput = document.getElementById('captchaInput').value;
    const captchaID = document.getElementById('captcha-id').value;

    if (!captchaInput || !captchaID) {
        homebridge.toast.error('Please enter a valid captcha code.', 'Error');
        return;
    }

    try {
        await whatsnext('/check-captcha', { id: captchaID, captcha: captchaInput });
    } catch (e) {
        homebridge.toast.error(e.error || e.message, 'Error');
    }

});

// step 2 otp submit handler
document.getElementById('step2-otp-Submit').addEventListener('click', async () => {

    const otpInput = document.getElementById('otpInput').value;

    if (!otpInput) {
        homebridge.toast.error('Please enter a valid OTP code.', 'Error');
        return;
    }

    try {
        await whatsnext('/check-otp', { code: otpInput });
    } catch (e) {
        homebridge.toast.error(e.error || e.message, 'Error');
    }

});

// step reset submit handler
document.getElementById('reset-confirm-btn').addEventListener('click', async () => {

    try {
        const response = await hb_request('/reset', {});

        if (response.result == 0) {
            homebridge.toast.error("First install or already resetted");
        }
        if (response.result == 1) {
            homebridge.toast.success("Success");
        }

        await homebridge.updatePluginConfig([]);
        await homebridge.savePluginConfig();
        homebridge.closeSettings();

    } catch (e) {
        homebridge.toast.error(e.error || e.message, 'Error');
    }

});

function download(strData, strFileName, strMimeType) {
    var D = document,
        A = arguments,
        a = D.createElement("a"),
        d = A[0],
        n = A[1],
        t = A[2] || "text/plain";

    //build download link:
    a.href = "data:" + strMimeType + "charset=utf-8," + escape(strData);


    if (window.MSBlobBuilder) { // IE10
        var bb = new MSBlobBuilder();
        bb.append(strData);
        return navigator.msSaveBlob(bb, strFileName);
    } /* end if(window.MSBlobBuilder) */



    if ('download' in a) { //FF20, CH19
        a.setAttribute("download", n);
        a.innerHTML = "downloading...";
        D.body.appendChild(a);
        setTimeout(function () {
            var e = D.createEvent("MouseEvents");
            e.initMouseEvent("click", true, false, window, 0, 0, 0, 0, 0, false, false, false, false, 0, null);
            a.dispatchEvent(e);
            D.body.removeChild(a);
        }, 66);
        return true;
    }; /* end if('download' in a) */



    //do iframe dataURL download: (older W3)
    var f = D.createElement("iframe");
    D.body.appendChild(f);
    f.src = "data:" + (A[2] ? A[2] : "application/octet-stream") + (window.btoa ? ";base64" : "") + "," + (window.btoa ? window.btoa : escape)(strData);
    setTimeout(function () {
        D.body.removeChild(f);
    }, 333);
    return true;
}

// step reset submit handler
// document.getElementById('get-lib-log').addEventListener('click', async () => {

//     try {
//         const response = await hb_request('/get-lib-logs', {});

//         if (response.result == 0) {
//             homebridge.toast.error("Unable to get it (did you run this plugin at least once?)");
//         }
//         if (response.result == 1) {
//             homebridge.toast.success("Success");
//             download(response.data, 'log-lib.log.gz', 'application/x-gzip')
//         }

//     } catch (e) {
//         homebridge.toast.error(e.error || e.message, 'Error');
//     }

// });


document.querySelectorAll('input[type=radio]').forEach(item => {
    item.addEventListener('change', event => {

        document.getElementsByName(item.name).forEach(atem => {
            atem.parentElement.classList.remove('active');
        });

        item.parentElement.classList.add('active');

        if (item.name === "cc-enableCamera-btn") {
            document.getElementById('camera-adv').style.display = (item.id === "cc-enableCamera-btn-true") ? 'block' : 'none';
            document.getElementById('cc-enableCamera').checked = (item.id === "cc-enableCamera-btn-true") ? true : false;
        }

        if (item.name === "cc-snapshotHandlingMethod-switch") {
            var v = 3;
            if (document.getElementById('cc-snapshotHandlingMethod-btn-1').checked) v = 1;
            if (document.getElementById('cc-snapshotHandlingMethod-btn-2').checked) v = 2;
            document.getElementById('cc-snapshotHandlingMethod').value = v;
        }

    });
});

document.querySelectorAll('input[type=checkbox].ena').forEach(item => {
    document.getElementById(item.id.slice(0, -4)).classList.add('disabled');
    item.addEventListener('change', event => {
        if (item.checked) {
            document.getElementById(item.id.slice(0, -4)).classList.remove('disabled');
        } else {
            document.getElementById(item.id.slice(0, -4)).classList.add('disabled');
        }
    });
});

document.querySelectorAll('input[type=checkbox]').forEach(item => {
    item.addEventListener('change', event => {
        if (item.id === "cc-useEnhancedSnapshotBehaviour") {
            document.getElementById('camera-snapshot-enh').style.display = (item.checked) ? 'block' : 'none';
            document.getElementById('camera-snapshot-old').style.display = (!item.checked) ? 'block' : 'none';
        }
    });
});

homebridge.addEventListener('CAPTCHA_NEEDED', (e) => {
    display_box('step2-captcha');
    document.getElementById('captcha-id').value = e.data.id;
    document.getElementById('captcha-img').innerHTML = '<img src="' + e.data.captcha + '" />';
    homebridge.hideSpinner();
});

homebridge.addEventListener('SEND_VERIFY_CODE', () => {
    display_box('step2-otp');
    homebridge.hideSpinner();
});

homebridge.addEventListener('CONNECTED', () => {
    getStations();
    homebridge.hideSpinner();
});



(async () => {
    // get the plugin config blocks (this returns an array)
    const pluginConfigBlocks = await homebridge.getPluginConfig();

    generate_country_selector('epc-country');
    generate_country_selector('countryInput1');

    if (!pluginConfigBlocks.length || !pluginConfigBlocks[0].username || !pluginConfigBlocks[0].password) {
        display_box('step1');
        if (pluginConfigBlocks[0])
            pluginConfig = pluginConfigBlocks[0];
        updateFormFromConfig();
    } else {
        pluginConfig = pluginConfigBlocks[0];
        updateFormFromConfig();
        await hb_request('/init', { username: pluginConfig.username, password: pluginConfig.password, country: pluginConfig.country });
        display_box('setupComplete');
    }

})();