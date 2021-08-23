
var pluginConfig = {
    platform: 'EufySecurity',
};

function updateFormFromConfig() {
    // populate the form

    document.getElementById('usernameInput').value = pluginConfig.username || '';
    document.getElementById('passwordInput').value = pluginConfig.password || '';
    document.getElementById('usernameInput1').value = pluginConfig.username || '';
    document.getElementById('passwordInput1').value = pluginConfig.password || '';
    document.getElementById('enableCamera').checked = pluginConfig.enableCamera || '';
    document.getElementById('pollingIntervalMinutes').value = !pluginConfig.pollingIntervalMinutes && pluginConfig.pollingIntervalMinutes !== 0 ? 30 : pluginConfig.pollingIntervalMinutes;
    document.getElementById('hkHome').value = pluginConfig.hkHome || "1";
    document.getElementById('hkAway').value = pluginConfig.hkAway || "0";
    document.getElementById('hkNight').value = pluginConfig.hkNight || "3";
    document.getElementById('hkOff').value = pluginConfig.hkOff || "63";
    document.getElementById('enableDetailedLogging').value = pluginConfig.enableDetailedLogging || "0";
    document.getElementById('ignoreStations').value = pluginConfig.ignoreStations || '';
    document.getElementById('ignoreDevices').value = pluginConfig.ignoreDevices || '';
    homebridge.fixScrollHeight();
}

function updateConfigFromForm() {
    pluginConfig.username = document.getElementById('usernameInput').value;
    pluginConfig.password = document.getElementById('passwordInput').value;
    pluginConfig.enableCamera = document.getElementById('enableCamera').checked;
    pluginConfig.pollingIntervalMinutes = parseInt(document.getElementById('pollingIntervalMinutes').value);
    pluginConfig.hkHome = parseInt(document.getElementById('hkHome').value);
    pluginConfig.hkAway = parseInt(document.getElementById('hkAway').value);
    pluginConfig.hkNight = parseInt(document.getElementById('hkNight').value);
    pluginConfig.hkOff = parseInt(document.getElementById('hkOff').value);
    pluginConfig.enableDetailedLogging = parseInt(document.getElementById('enableDetailedLogging').value);
    pluginConfig.ignoreStations = document.getElementById('ignoreStations').value;
    pluginConfig.ignoreDevices = document.getElementById('ignoreDevices').value;
}

function showHideTokenButton() {
    const usernameInput = document.getElementById('usernameInput').value;
    const passwordInput = document.getElementById('passwordInput').value;
    document.getElementById('startOver').style.display = (!usernameInput || !passwordInput) ? 'inline-block' : 'none';
}

function adjustPollingValue() {
    const pollingValue = document.getElementById('pollingIntervalMinutes').value;
    document.getElementById('pollingValue').innerHTML = pollingValue + ' minutes';
}

async function AddOrRemoveStationsIgnoreList(item) {
    pluginConfig.ignoreStations.indexOf(item) === -1 ? pluginConfig.ignoreStations.push(item) : pluginConfig.ignoreStations.splice(pluginConfig.ignoreStations.indexOf(item), 1);
    document.getElementById('ignoreStations').value = pluginConfig.ignoreStations.toString();
    await homebridge.updatePluginConfig([pluginConfig]);
    await homebridge.savePluginConfig();
}

async function AddOrRemoveDevicesIgnoreList(item) {
    pluginConfig.ignoreDevices.indexOf(item) === -1 ? pluginConfig.ignoreDevices.push(item) : pluginConfig.ignoreDevices.splice(pluginConfig.ignoreDevices.indexOf(item), 1);
    document.getElementById('ignoreDevices').value = pluginConfig.ignoreDevices.toString();
    await homebridge.updatePluginConfig([pluginConfig]);
    await homebridge.savePluginConfig();
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
    pluginConfig.username = document.getElementById('usernameInput1').value;
    pluginConfig.password = document.getElementById('passwordInput1').value;
    document.getElementById('usernameInput').value = document.getElementById('usernameInput1').value;
    document.getElementById('passwordInput').value = document.getElementById('passwordInput1').value;

    pluginConfig.ignoreStations = pluginConfig.ignoreStations || [];
    pluginConfig.ignoreDevices = pluginConfig.ignoreDevices || [];

    await homebridge.updatePluginConfig([pluginConfig]);
    await homebridge.savePluginConfig();

    const s_div = document.getElementById('stations');

    if(!stations){
        s_div.innerHTML = '<span style="color:red; font-weight:bold;"><h3>Error: Nothing to retreive!</h3></span>';
        return;
    }

    const t1 = document.createElement("div");
    t1.setAttribute('class', 'divTable');

    const h1 = document.createElement("div");
    h1.setAttribute('class', 'divTableHeading');

    var r1 = document.createElement("div");
    r1.setAttribute('class', 'divTableRow');
    r1.innerHTML = `
                    <div class="divTableCell">Name</div>
                    <div class="divTableCell">Serial Number</div>
                    <div class="divTableCell">Type</div>
                    <div class="divTableCell">Ignore?</div>
                `;
    h1.appendChild(r1);
    t1.appendChild(h1);

    stations.forEach(function (item) {

        const checked = (isStationsIgnored(item.uniqueId)) ? ' checked' : '';

        const b1 = document.createElement("div");
        b1.setAttribute('class', 'divTableBody' + checked);
        b1.setAttribute('id', `station_${item.uniqueId}`);

        var r1 = document.createElement("div");

        r1.setAttribute('class', 'divTableRow');

        r1.innerHTML = `
                    <div class="divTableCell">${item.displayName}</div>
                    <div class="divTableCell">${item.uniqueId}</div>
                    <div class="divTableCell">${item.type}</div>
                    <div class="divTableCell"><input type="checkbox" class="ignore_stations" id="st_${item.uniqueId}" name="${item.uniqueId}"${checked} /></div>
                `;
        b1.appendChild(r1);

        item.devices.forEach(function (item) {

            if (item.ignore) {
                AddOrRemoveDevicesIgnoreList(item.uniqueId);
            }
            var r2 = document.createElement("div");
            const checked = (isDevicesIgnored(item.uniqueId)) ? ' checked' : '';
            r2.setAttribute('class', 'divTableRow' + checked);
            r2.setAttribute('id', `device_${item.uniqueId}`);
            r2.innerHTML = `
                    <div class="divTableCell">|--&nbsp;${item.displayName}</div>
                    <div class="divTableCell">${item.uniqueId}</div>
                    <div class="divTableCell">${item.type}</div>
                    <div class="divTableCell"><input type="checkbox" class="ignore_devices" id="dev_${item.uniqueId}" name="${item.uniqueId}"${checked} /></div>
                `;
            b1.appendChild(r2);
        });

        t1.appendChild(b1);
    });

    s_div.appendChild(t1);

    stations.forEach(function (item) {

        document.getElementById(`st_${item.uniqueId}`).addEventListener('change', async e => {
            if (e.target.checked) {
                document.getElementById(`station_${item.uniqueId}`).setAttribute('class', 'divTableBody checked');
            } else {
                document.getElementById(`station_${item.uniqueId}`).setAttribute('class', 'divTableBody');
            }
            await AddOrRemoveStationsIgnoreList(item.uniqueId);
        });

        item.devices.forEach(function (item) {

            document.getElementById(`dev_${item.uniqueId}`).addEventListener('change', async e => {
                if (e.target.checked) {
                    document.getElementById(`device_${item.uniqueId}`).setAttribute('class', 'divTableRow checked');

                } else {
                    document.getElementById(`device_${item.uniqueId}`).setAttribute('class', 'divTableRow');
                }
                await AddOrRemoveDevicesIgnoreList(item.uniqueId);
            });
        });

    });
}

(async () => {
    // get the plugin config blocks (this returns an array)
    const pluginConfigBlocks = await homebridge.getPluginConfig();

    if (!pluginConfigBlocks.length || !pluginConfigBlocks[0].username || !pluginConfigBlocks[0].password) {
        document.getElementById('setupRequired').style.display = 'block';
        if (pluginConfigBlocks[0])
            pluginConfig = pluginConfigBlocks[0];
        updateFormFromConfig();
    } else {
        pluginConfig = pluginConfigBlocks[0];
        updateFormFromConfig();
        document.getElementById('setupComplete').style.display = 'block';
    }

    adjustPollingValue()
    //showHideTokenButton()
})();

// watch for changes to the config form
document.getElementById('configForm').addEventListener('change', async () => {
    // extract the values from the form - stored in var pluginConfig.
    updateConfigFromForm();
    adjustPollingValue()

    // send the current value to the UI.
    await homebridge.updatePluginConfig([pluginConfig]);
    await homebridge.savePluginConfig();
});


document.getElementById('pollingIntervalMinutes').addEventListener('input', adjustPollingValue);
document.getElementById('usernameInput').addEventListener('input', showHideTokenButton);
document.getElementById('passwordInput').addEventListener('input', showHideTokenButton);


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


// skip
document.getElementById('skip').addEventListener('click', async () => {
    document.getElementById('step2').style.display = 'none';
    document.getElementById('setupRequired').style.display = 'none';
    document.getElementById('setupComplete').style.display = 'block';
});


// skip2
document.getElementById('skip2').addEventListener('click', async () => {
    document.getElementById('step2').style.display = 'none';
    document.getElementById('setupRequired').style.display = 'none';
    document.getElementById('setupComplete').style.display = 'block';
});


// startOver
document.getElementById('startOver').addEventListener('click', async () => {
    document.getElementById('setupRequired').style.display = 'block';
    document.getElementById('step2').style.display = 'none';
    document.getElementById('setupComplete').style.display = 'none';
});

// step 1 submit handler
document.getElementById('step1Submit').addEventListener('click', async () => {
    const usernameValue = document.getElementById('usernameInput1').value;
    const passwordValue = document.getElementById('passwordInput1').value;

    if (!usernameValue || !passwordValue) {
        homebridge.toast.error('Please enter your username and password.', 'Error');
        return;
    }

    document.getElementById('step1Submit').setAttribute('disabled', 'disabled');

    try {
        homebridge.showSpinner()
        const response = await homebridge.request('/request-otp', { username: usernameValue, password: passwordValue });
        homebridge.hideSpinner()
        if (response.result == 0) {
            homebridge.toast.error("Wrong username or password");
            return;
        }
        document.getElementById('step1').style.display = 'none';
        if (response.result == 1)
            document.getElementById('step2').style.display = 'block';
        if (response.result == 2) {
            document.getElementById('step3').style.display = 'block';
            await list_stations_devices(response.stations);
        }
    } catch (e) {
        homebridge.hideSpinner()
        homebridge.toast.error(e.message, 'Error');
    }

    document.getElementById('step1Submit').removeAttribute('disabled');
});

// step 2 submit handler
document.getElementById('step2Submit').addEventListener('click', async () => {
    const otpValue = document.getElementById('otpInput').value;

    if (!otpValue) {
        homebridge.toast.error('Please enter a valid OTP code.', 'Error');
        return;
    }

    document.getElementById('step2Submit').setAttribute('disabled', 'disabled');

    try {
        homebridge.showSpinner()
        const response = await homebridge.request('/check-otp', { code: otpValue });
        document.getElementById('step2').style.display = 'none';

        homebridge.hideSpinner()
        if (response.result == 0) {
            homebridge.toast.error("Wrong OTP");
            document.getElementById('step1').style.display = 'block';
        }
        if (response.result == 2) {
            document.getElementById('step3').style.display = 'block';
            await list_stations_devices(response.stations);
        }

    } catch (e) {
        homebridge.hideSpinner()
        homebridge.toast.error(e.error || e.message, 'Error');
    }

    document.getElementById('step2Submit').removeAttribute('disabled');
});
