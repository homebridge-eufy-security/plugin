
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
    document.getElementById('enableDetailedLogging').checked = pluginConfig.enableDetailedLogging || '';
    document.getElementById('ignoreStations').value = pluginConfig.ignoreStations || [];
    document.getElementById('ignoreDevices').value = pluginConfig.ignoreDevices || [];
    document.getElementById('country').value = pluginConfig.country || "US";
    document.getElementById('countryInput1').value = pluginConfig.country || "US";
    document.getElementById('CameraMaxLivestreamDuration').value = pluginConfig.CameraMaxLivestreamDuration || 30;
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
    pluginConfig.enableDetailedLogging = parseInt(document.getElementById('enableDetailedLogging').checked * 1);
    pluginConfig.ignoreStations = document.getElementById('ignoreStations').value.split(",");
    pluginConfig.ignoreDevices = document.getElementById('ignoreDevices').value.split(",");
    pluginConfig.country = document.getElementById('country').value;
    pluginConfig.CameraMaxLivestreamDuration = parseInt(document.getElementById('CameraMaxLivestreamDuration').value);
}

function adjustPollingValue() {
    const pollingValue = parseInt(document.getElementById('pollingIntervalMinutes').value);
    document.getElementById('pollingValue').innerHTML = pollingValue + ' minutes';
}

function adjustCMLDPollingValue() {
    const pollingValue = parseInt(document.getElementById('CameraMaxLivestreamDuration').value);
    document.getElementById('CMLDpollingValue').innerHTML = pollingValue + ' seconds';
}

async function AddOrRemoveStationsIgnoreList(item) {
    pluginConfig.ignoreStations.indexOf(item) === -1 ? pluginConfig.ignoreStations.push(item) : pluginConfig.ignoreStations.splice(pluginConfig.ignoreStations.indexOf(item), 1);
    document.getElementById('ignoreStations').value = pluginConfig.ignoreStations.toString();
    await homebridge.updatePluginConfig([pluginConfig]);
}

async function AddOrRemoveDevicesIgnoreList(item) {
    pluginConfig.ignoreDevices.indexOf(item) === -1 ? pluginConfig.ignoreDevices.push(item) : pluginConfig.ignoreDevices.splice(pluginConfig.ignoreDevices.indexOf(item), 1);
    document.getElementById('ignoreDevices').value = pluginConfig.ignoreDevices.toString();
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
    
    document.getElementById('step2').style.display = 'none';
    document.getElementById('step3').style.display = 'block';

    if (!stations.length) {
        s_div.innerHTML = '<span style="color:red; font-weight:bold;">Error: Nothing have been retreived!</span>';
        return;
    }

    pluginConfig.username = document.getElementById('usernameInput1').value;
    pluginConfig.password = document.getElementById('passwordInput1').value;
    pluginConfig.country = document.getElementById('countryInput1').value;
    document.getElementById('usernameInput').value = document.getElementById('usernameInput1').value;
    document.getElementById('passwordInput').value = document.getElementById('passwordInput1').value;
    document.getElementById('country').value = document.getElementById('countryInput1').value;

    pluginConfig.ignoreStations = (typeof pluginConfig.ignoreStations === 'object') ? pluginConfig.ignoreStations : [];
    pluginConfig.ignoreDevices = (typeof pluginConfig.ignoreDevices === 'object') ? pluginConfig.ignoreDevices : [];

    await homebridge.updatePluginConfig([pluginConfig]);

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
        b1.setAttribute('class', 'divTableBody');

        var r1 = document.createElement("div");

        r1.setAttribute('class', 'divTableRow' + checked);
        r1.setAttribute('id', `s_${item.uniqueId}`);

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
            r2.setAttribute('id', `d_${item.uniqueId}`);
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
                document.getElementById(`s_${item.uniqueId}`).setAttribute('class', 'divTableRow checked');
            } else {
                document.getElementById(`s_${item.uniqueId}`).setAttribute('class', 'divTableRow');
            }
            await AddOrRemoveStationsIgnoreList(item.uniqueId);
        });

        item.devices.forEach(function (item) {

            document.getElementById(`dev_${item.uniqueId}`).addEventListener('change', async e => {
                if (e.target.checked) {
                    document.getElementById(`d_${item.uniqueId}`).setAttribute('class', 'divTableRow checked');

                } else {
                    document.getElementById(`d_${item.uniqueId}`).setAttribute('class', 'divTableRow');
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

    adjustPollingValue();
    adjustCMLDPollingValue();
})();

// watch for changes to the config form
document.getElementById('configForm').addEventListener('change', async () => {
    // extract the values from the form - stored in var pluginConfig.
    updateConfigFromForm();
    adjustPollingValue();
    adjustCMLDPollingValue();

    // send the current value to the UI.
    await homebridge.updatePluginConfig([pluginConfig]);
});


document.getElementById('pollingIntervalMinutes').addEventListener('input', adjustPollingValue);
document.getElementById('CameraMaxLivestreamDuration').addEventListener('input', adjustCMLDPollingValue);


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
    document.getElementById('reset-box').style.display = 'none';
});


// skip2
document.getElementById('skip2').addEventListener('click', async () => {
    document.getElementById('step2').style.display = 'none';
    document.getElementById('setupRequired').style.display = 'none';
    document.getElementById('setupComplete').style.display = 'block';
    document.getElementById('reset-box').style.display = 'none';
});


// skip-reset
document.getElementById('skip-reset').addEventListener('click', async () => {
    document.getElementById('step2').style.display = 'none';
    document.getElementById('setupRequired').style.display = 'none';
    document.getElementById('setupComplete').style.display = 'block';
    document.getElementById('reset-box').style.display = 'none';
});


// startOver
document.getElementById('startOver').addEventListener('click', async () => {
    document.getElementById('setupRequired').style.display = 'block';
    document.getElementById('step2').style.display = 'none';
    document.getElementById('setupComplete').style.display = 'none';
    document.getElementById('reset-box').style.display = 'none';
});


// Reset
document.getElementById('reset').addEventListener('click', async () => {
    document.getElementById('setupRequired').style.display = 'none';
    document.getElementById('reset-box').style.display = 'block';
    document.getElementById('step2').style.display = 'none';
    document.getElementById('setupComplete').style.display = 'none';
});

// step 1 submit handler
document.getElementById('step1Submit').addEventListener('click', async () => {
    const usernameValue = document.getElementById('usernameInput1').value;
    const passwordValue = document.getElementById('passwordInput1').value;
    const countryValue = document.getElementById('countryInput1').value;

    if (!usernameValue || !passwordValue) {
        homebridge.toast.error('Please enter your username and password.', 'Error');
        return;
    }

    document.getElementById('step1Submit').setAttribute('disabled', 'disabled');

    try {
        homebridge.showSpinner();
        const response = await homebridge.request('/request-otp', { username: usernameValue, password: passwordValue, country: countryValue });
        homebridge.hideSpinner();

        if (response.result == 0) {
            homebridge.toast.error("Wrong username or password");
            document.getElementById('step1Submit').removeAttribute('disabled');
        } else {
            document.getElementById('step1').style.display = 'none';
            if (response.result == 1)
                document.getElementById('step2').style.display = 'block';
            if (response.result == 2) {
                await refreshData();
                await getStations();
            }
        }
    } catch (e) {
        homebridge.hideSpinner()
        homebridge.toast.error(e.message, 'Error');
    }
});

async function refreshData() {
    try {
        homebridge.showSpinner();
        homebridge.toast.info('Refreshing Data....');
        await homebridge.request('/refreshData');
        homebridge.hideSpinner();
    } catch (e) {
        homebridge.hideSpinner();
        homebridge.toast.error(e.message, 'Error');
    }
}

async function getStations() {
    try {

        homebridge.showSpinner();
        homebridge.toast.info('Getting Devices....');
        const response = await homebridge.request('/getStations');
        homebridge.hideSpinner();

        await list_stations_devices(response.stations);
    } catch (e) {
        homebridge.hideSpinner();
        homebridge.toast.error(e.message, 'Error');
    }
}

// step 2 submit handler
document.getElementById('step2Submit').addEventListener('click', async () => {
    const otpValue = document.getElementById('otpInput').value;

    if (!otpValue) {
        homebridge.toast.error('Please enter a valid OTP code.', 'Error');
        return;
    }

    document.getElementById('step2Submit').setAttribute('disabled', 'disabled');

    try {
        homebridge.showSpinner();
        const response = await homebridge.request('/check-otp', { code: otpValue });

        homebridge.hideSpinner();
        if (response.result == 0) {
            homebridge.toast.error("Wrong OTP");
            document.getElementById('step2Submit').removeAttribute('disabled');
        }
        if (response.result == 1) {
            await refreshData();
            await getStations();
        }

    } catch (e) {
        homebridge.hideSpinner()
        homebridge.toast.error(e.error || e.message, 'Error');
    }

});

// step reset submit handler
document.getElementById('reset-confirm-btn').addEventListener('click', async () => {

    document.getElementById('reset-confirm-btn').setAttribute('disabled', 'disabled');

    try {
        homebridge.showSpinner();
        const response = await homebridge.request('/reset', {});

        await homebridge.updatePluginConfig([]);
        await homebridge.savePluginConfig();
        homebridge.closeSettings();

        homebridge.hideSpinner();
        if (response.result == 0) {
            homebridge.toast.error("First install or already resetted");
        }
        if (response.result == 1) {
            homebridge.toast.success("Success");
        }

    } catch (e) {
        homebridge.hideSpinner()
        homebridge.toast.error(e.error || e.message, 'Error');
    }

});
