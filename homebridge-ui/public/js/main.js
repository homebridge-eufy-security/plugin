var pluginConfig = {
    platform: 'EufySecurity',
};

function updateFormFromConfig() {
    // populate the form

    document.getElementById('usernameInput').value = pluginConfig.username ??= '';
    document.getElementById('passwordInput').value = pluginConfig.password ??= '';
    document.getElementById('usernameInput1').value = pluginConfig.username ??= '';
    document.getElementById('passwordInput1').value = pluginConfig.password ??= '';
    document.getElementById('enableCamera').checked = pluginConfig.enableCamera ??= '';
    document.getElementById('pollingIntervalMinutes').value = pluginConfig.pollingIntervalMinutes ??= 30;
    document.getElementById('hkHome').value = pluginConfig.hkHome ??= '1';
    document.getElementById('hkAway').value = pluginConfig.hkAway ??= '0';
    document.getElementById('hkNight').value = pluginConfig.hkNight ??= '3';
    document.getElementById('hkOff').value = pluginConfig.hkOff ??= '63';
    document.getElementById('enableDetailedLogging').checked = pluginConfig.enableDetailedLogging ??= '';
    document.getElementById('ignoreStations').value = pluginConfig.ignoreStations ??= [];
    document.getElementById('ignoreDevices').value = pluginConfig.ignoreDevices ??= [];
    document.getElementById('country').value = pluginConfig.country ??= 'US';
    document.getElementById('countryInput1').value = pluginConfig.country ??= 'US';
    document.getElementById('CameraMaxLivestreamDuration').value = pluginConfig.CameraMaxLivestreamDuration ??= 30;
    document.getElementById('cleanCache').checked = pluginConfig.cleanCache ??= true;
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
    pluginConfig.cleanCache = document.getElementById('cleanCache').checked;
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

    display_setupRequired('step3');

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
        display_setupRequired('step1');
        if (pluginConfigBlocks[0])
            pluginConfig = pluginConfigBlocks[0];
        updateFormFromConfig();
    } else {
        pluginConfig = pluginConfigBlocks[0];
        updateFormFromConfig();
        display_setupCompleted();
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


document.querySelectorAll('.skip').forEach(item => {
    item.addEventListener('click', event => {
        display_setupCompleted();
    })
});

// startOver
document.getElementById('startOver').addEventListener('click', async () => {
    display_setupRequired('step1');
});


// Reset
document.getElementById('reset').addEventListener('click', async () => {
    display_reset();
});

// step 1 submit handler
document.querySelectorAll('.startover').forEach(item => {
    item.addEventListener('click', async event => {

        homebridge.showSpinner();

        const usernameValue = document.getElementById('usernameInput1').value;
        const passwordValue = document.getElementById('passwordInput1').value;
        const countryValue = document.getElementById('countryInput1').value;

        if (!usernameValue || !passwordValue) {
            homebridge.toast.error('Please enter your username and password.', 'Error');
            homebridge.hideSpinner();
            return;
        }

        try {
            const response = await homebridge.request('/auth', { username: usernameValue, password: passwordValue, country: countryValue });
            homebridge.hideSpinner();

            if (response.result == 0) {
                homebridge.toast.error("Wrong username or password");
            } else {
                if (response.result == 1)
                    display_setupRequired('step2-captcha');
                if (response.result == 2)
                    display_setupRequired('step2-otp');
                if (response.result == 3) {
                    await refreshData();
                    await getStations();
                }
            }
        } catch (e) {
            homebridge.hideSpinner()
            homebridge.toast.error(e.message, 'Error');
        }
    })
});

function display_setupCompleted(display) {
    document.getElementById('setupComplete').style.display = 'block';
    document.getElementById('setupRequired').style.display = 'none';
    document.getElementById('reset-box').style.display = 'none';
}

function display_reset(display) {
    document.getElementById('setupComplete').style.display = 'none';
    document.getElementById('setupRequired').style.display = 'none';
    document.getElementById('reset-box').style.display = 'block';
}

function display_setupRequired(display) {
    const bloc = ['step1', 'step2-captcha', 'step2-otp', 'step3'];

    document.getElementById('setupComplete').style.display = 'none';
    document.getElementById('setupRequired').style.display = 'block';
    document.getElementById('reset-box').style.display = 'none';

    bloc.forEach(e => {
        document.getElementById(e).style.display = (e === display) ? 'block' : 'none';
    });

}

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

// step 2 captcha submit handler
document.getElementById('step2-captcha-Submit').addEventListener('click', async () => {
    homebridge.showSpinner();
    const captchaInput = document.getElementById('captchaInput').value;
    const captchaID = document.getElementById('captcha-id').value;

    if (!captchaInput || !captchaID) {
        homebridge.toast.error('Please enter a valid captcha code.', 'Error');
        homebridge.hideSpinner();
        return;
    }

    try {
        const response = await homebridge.request('/check-captcha', { id: captchaID, captcha: captchaInput });

        homebridge.hideSpinner();
        if (response.result == 0) {
            homebridge.toast.error("Wrong OTP");
        } else {
            if (response.result == 1)
                display_setupRequired('step2-captcha');
            if (response.result == 2)
                display_setupRequired('step2-otp');
            if (response.result == 3) {
                await refreshData();
                await getStations();
            }
        }

    } catch (e) {
        homebridge.hideSpinner()
        homebridge.toast.error(e.error || e.message, 'Error');
    }

});

// step 2 otp submit handler
document.getElementById('step2-otp-Submit').addEventListener('click', async () => {
    homebridge.showSpinner();
    const otpInput = document.getElementById('otpInput').value;

    if (!otpInput) {
        homebridge.toast.error('Please enter a valid OTP code.', 'Error');
        homebridge.hideSpinner();
        return;
    }

    try {
        const response = await homebridge.request('/check-otp', { code: otpInput });

        homebridge.hideSpinner();
        if (response.result == 0) {
            homebridge.toast.error("Wrong OTP");
        } else {
            if (response.result == 1)
                display_setupRequired('step2-captcha');
            if (response.result == 2)
                display_setupRequired('step2-otp');
            if (response.result == 3) {
                await refreshData();
                await getStations();
            }
        }

    } catch (e) {
        homebridge.hideSpinner()
        homebridge.toast.error(e.error || e.message, 'Error');
    }

});

// step reset submit handler
document.getElementById('reset-confirm-btn').addEventListener('click', async () => {

    try {
        homebridge.showSpinner();
        const response = await homebridge.request('/reset', {});

        homebridge.hideSpinner();
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
        homebridge.hideSpinner()
        homebridge.toast.error(e.error || e.message, 'Error');
    }

});

homebridge.addEventListener('captcha', (e) => {
    console.log(JSON.stringify(e.data.id));
    console.log(JSON.stringify(e.data.captcha));
    document.getElementById('captcha-id').value = e.data.id;
    document.getElementById('captcha-img').innerHTML = '<img src="' + e.data.captcha + '" />';
});