//Global vars
tclock = null;
ui_event_state = {};
cur_states = {};
ui_initialized = false;
ui_initializing = false;
noSleep = null;
screen_mode = "off";

//--Classes...err... Protypes? err... object constructors?--//
//For interacting with the clock.
function ToddlerClock(opts) {
    //api_url,api_timeout,api_mode,message_process_map,switch_callback
    //--Private Variabls...--//
    var url = null;
    var wsh = null;
    var ws_chk_interval = null;
    var mode = "";
    var mode_forced = false;
    var switching = false;
    var deferred_switches = []; //This eliminates race conditions when _switch_mode is called multiple times quickly
    var _api_url = "/";
    var _api_timeout = 10000;
    var _switch_callback = opts.switch_callback;
    var _message_process_map = opts.message_process_map;
    //--Private Functions--//
    var _ws_connected_chk = function () {
        if (!wsh.connected()) {
            console.log("Websocket failed to connect, Trying to failback to 'rest' mode");
            if (mode_forced) {
                console.error("ERROR: mode specified is forced to be 'websocket'");
            }
            else {
                console.log("Using: 'rest' mode for ToddlerClock communications");
                _switch_mode("rest");
            }   
        }
    }
    var _switch_mode = function (apimode) {
        if (mode == apimode) {
            return;
        }
        if (switching) {
            deferred_switches.push(apimode);
            return;
        }
        switching = true;
        console.log("Changing mode to: " + apimode);
        if (apimode == "websocket") {
            if(wsh.connected()) {
                status = ws_status;
                poll = ws_poll;
                intervals = ws_intervals;
                new_interval = ws_new_interval;
                update_interval = ws_update_interval;
                delete_interval = ws_delete_interval;
                light = ws_light;
                mode = "websocket";
            }
            else {
                console.warn("Failed changing mode to 'websocket', websocket is not connected");
            }
            if (_switch_callback) {
                _switch_callback(mode);
            }
            switching = false;
            if (deferred_switches.length > 0) {
                _switch_mode(deferred_switches.shift());
            }
        }
        else if (apimode == "rest") {
            if (mode) {
                if (mode == "websocket") {
                    if (wsh) {
                        if (wsh.connected()) {
                            wsh.close();
                            clearTimeout(ws_chk_timeout);
                            ws_chk_timeout = null;
                        }
                    }
                }
            }
            rest_status(
                {
                    intervals: false,
                    state: false,
                },
                function(data) {
                    status = rest_status;
                    poll = rest_poll;
                    intervals = rest_intervals;
                    new_interval = rest_new_interval;
                    update_interval = rest_update_interval;
                    delete_interval = rest_delete_interval;
                    light = rest_light;
                    mode = "rest";
                    if (_switch_callback) {
                        _switch_callback(mode);
                    }
                    switching = false;
                    if (deferred_switches.length > 0) {
                        _switch_mode(deferred_switches.shift());
                    }
                },
                function(jqXhr, textStatus, errorMessage) {
                    console.error("Failed changing mode to 'rest':" + errorMessage);
                    if (_switch_callback) {
                        _switch_callback(mode);
                    }
                    switching = false;
                    if (deferred_switches.length > 0) {
                        _switch_mode(deferred_switches.shift());
                    }
                }
            );
        }
        else {
            console.warn("Unknown mode: " + mode + " . Must be one of 'rest', or 'websocket'");
        }
    };
    var _connect_websocket = function () {
        if ("WebsocketHelper" in window) {
            if (!mode_forced || mode == "websocket") {
                if (wsh) {
                    if (wsh.connected()) {
                        wsh.close();
                        clearTimeout(ws_chk_timeout);
                        ws_chk_timeout = null;
                    }
                }
                wsh = new WebsocketHelper('ws://' + url.host + url.pathname + '/websocket',_api_timeout);
                wsh.onopen(function (evt) {
                    _switch_mode("websocket");
                    clearTimeout(ws_chk_timeout);
                    ws_chk_timeout = null;
                });
                wsh.onmessage(function (evt) {
                    _process_message(evt);
                });
                ws_chk_timeout = setTimeout(_ws_connected_chk,3000);
            }
        }
        else {
            if (!mode_forced || mode == "websocket") {
                throw ("Websocket is not supported by your browser");
            }
        }
    }
    var _getLocation = function (href) {
        //Lifted from: http://stackoverflow.com/a/13405933
        var location = document.createElement("a");
        location.href = href;
        if (location.host == "") {
            location.href = location.href;
        }
        return location;
    };
    var _process_message = function(evt) {
        var data = JSON.parse(evt.data);
        if (_message_process_map[data.command]) {
            _message_process_map[data.command](data.data);
        }
        else {
            console.warn("Recieved unknown command from server: " + data.command);
            console.warn(data);
        }
    }
    //Place holders for what our public functions will call
    var status = function() {return};
    var poll = function() {return};
    var intervals = function() {return};
    var new_interval = function() {return};
    var update_interval = function() {return};
    var delete_interval = function() {return};
    var light = function() {return};
    //Rest API functions
    var rest_status = function (params,success_callback,fail_callback) {
        $.ajax({
            type: "GET",
            url: _api_url + "status",
            dataType: 'json',
            data: params,
            timeout: _api_timeout,
            success: function (data,status,xhr) {
                if (success_callback) {
                    success_callback(data,status,xhr);
                }
            },
            error: function(jqXhr, textStatus, errorMessage) {
                if (fail_callback) {
                    fail_callback(jqXhr, textStatus, errorMessage);
                }
            }
        });
    }
    var rest_poll = function (success_callback,fail_callback) {
        $.ajax({
            type: "GET",
            url: _api_url + "poll",
            dataType: 'json',
            timeout: _api_timeout,
            success: function (data,status,xhr) {
                if (success_callback) {
                    success_callback(data,status,xhr);
                }
            },
            error: function(jqXhr, textStatus, errorMessage) {
                if (fail_callback) {
                    fail_callback(jqXhr, textStatus, errorMessage);
                }
            }
        });
    }
    var rest_intervals = function (color,success_callback,fail_callback) {
        var uri = "interval"
        if (color) {
            uri = uri + "/" + color;
        }
        $.ajax({
            type: "GET",
            url: _api_url + uri,
            dataType: 'json',
            timeout: _api_timeout,
            success: function (data,status,xhr) {
                if (success_callback) {
                    success_callback(data,status,xhr);
                }
            },
            error: function(jqXhr, textStatus, errorMessage) {
                if (fail_callback) {
                    fail_callback(jqXhr, textStatus, errorMessage);
                }
            }
        });
    }
    var rest_new_interval = function (color,interval_details,success_callback,fail_callback) {
        $.ajax({
            type: "POST",
            url: _api_url + 'interval/' + color,
            contentType: 'application/json',
            dataType: 'json',
            timeout: _api_timeout,
            data: JSON.stringify(interval_details),
            success: function(data,status,xhr) {
                if (success_callback) {
                    success_callback(data,status,xhr);
                }
            },
            error: function(jqXhr, textStatus, errorMessage) {
                if (fail_callback) {
                    fail_callback(jqXhr,textStatus,errorMessage);
                }
            }
        });
    }
    var rest_update_interval = function (color,interval_id,interval_details,success_callback,fail_callback) {
        $.ajax({
            type: "PUT",
            url: _api_url + 'interval/' + color + "/" + interval_id,
            dataType: 'json',
            contentType: 'application/json',
            timeout: _api_timeout,
            data: JSON.stringify(interval_details),
            success: function(data,status,xhr) {
                if (success_callback) {
                    success_callback(data,status,xhr);
                }
            },
            error: function(jqXhr, textStatus, errorMessage) {
                if (fail_callback) {
                    fail_callback(jqXhr,textStatus,errorMessage);
                }
            }
        });
    }
    var rest_delete_interval = function (color,interval_id,success_callback,fail_callback) {
        $.ajax({
            type: "DELETE",
            url: _api_url + 'interval/' + color + "/" + interval_id,
            dataType: 'json',
            contentType: 'application/json',
            timeout: _api_timeout,
            success: function(data,status,xhr) {
                if (success_callback) {
                    success_callback(data,status,xhr);
                }
            },
            error: function(jqXhr, textStatus, errorMessage) {
                if (fail_callback) {
                    fail_callback(jqXhr, textStatus, errorMessage);
                }
            }
        });
    }
    var rest_light = function (color,state,brightness,override_intervals,success_callback,fail_callback) {
        var light_state = {
            'state': state
        }
        if (brightness) {
            light_state['brightness'] = brightness;
        }
        if (override_intervals) {
            light_state['override_intervals'] = override_intervals;
        }
        $.ajax({
            type: "PUT",
            url: _api_url + 'light/' + color,
            dataType: 'json',
            contentType: 'application/json',
            timeout: _api_timeout,
            data: JSON.stringify(light_state),
            success: function(data,status,xhr) {
                if (success_callback) {
                    success_callback(data,status,xhr);
                }
            },
            error: function(jqXhr, textStatus, errorMessage) {
                if (fail_callback) {
                    fail_callback(jqXhr,textStatus,errorMessage);
                }
            }
        });
    }
    //Websocket API functions
    var ws_status = function (params,success_callback,fail_callback) {
        var p = {};
        if (params) {
            p = params;
        }
        p['command'] = 'status';
        wsh.send(
            JSON.stringify(p),
            function (data) {
                if (data.result == "Success") {
                    if (success_callback) {
                        success_callback(data);
                    }
                }
                else {
                    if (fail_callback) {
                        data['responseJSON'] = data;
                        fail_callback(data);
                    }
                }
            }
        );
    }
    var ws_poll = function (success_callback,fail_callback) {
        wsh.send(
            JSON.stringify({
                command: 'poll',
            }),
            function (data) {
                if (data.result == "Success") {
                    if (success_callback) {
                        success_callback(data);
                    }
                }
                else {
                    if (fail_callback) {
                        data['responseJSON'] = data;
                        fail_callback(data);
                    }
                }
            }
        );
    }
    var ws_intervals = function (color,success_callback,fail_callback) {
        wsh.send(
            JSON.stringify({
                command: 'get_intervals',
                color: color
            }),
            function (data) {
                if (data.result == "Success") {
                    if (success_callback) {
                        success_callback(data);
                    }
                }
                else {
                    if (fail_callback) {
                        data['responseJSON'] = data;
                        fail_callback(data);
                    }
                }
            }
        );
    }
    var ws_new_interval = function (color,interval_details,success_callback,fail_callback) {
        wsh.send(
            JSON.stringify({
                command: 'new_interval',
                color: color,
                interval_details: interval_details
            }),
            function (data) {
                if (data.result == "Success") {
                    if (success_callback) {
                        success_callback(data);
                    }
                }
                else {
                    if (fail_callback) {
                        data['responseJSON'] = data;
                        fail_callback(data);
                    }
                }
            }
        );
    }
    var ws_update_interval = function (color,interval_id,interval_details,success_callback,fail_callback) {
        wsh.send(
            JSON.stringify({
                command: 'update_interval',
                color: color,
                interval_id: interval_id,
                interval_details: interval_details
            }),
            function (data) {
                if (data.result == "Success") {
                    if (success_callback) {
                        success_callback(data);
                    }
                }
                else {
                    if (fail_callback) {
                        data['responseJSON'] = data;
                        fail_callback(data);
                    }
                }
            }
        );
    }
    var ws_delete_interval = function (color,interval_id,success_callback,fail_callback) {
        wsh.send(
            JSON.stringify({
                command: 'delete_interval',
                color: color,
                interval_id: interval_id,
            }),
            function (data) {
                if (data.result == "Success") {
                    if (success_callback) {
                        success_callback(data);
                    }
                }
                else {
                    if (fail_callback) {
                        data['responseJSON'] = data;
                        fail_callback(data);
                    }
                }
            }
        );
    }
    var ws_light = function (color,state,brightness,override_intervals,success_callback,fail_callback) {
        var opts = {
            color: color,
            command: 'change_light',
            state: state
        }
        if (brightness) {
            opts['brightness'] = brightness;
        }
        if (override_intervals) {
            opts['override_intervals'] = override_intervals;
        }
        wsh.send(
            JSON.stringify(opts),
            function (data) {
                if (data.result == "Success") {
                    if (success_callback) {
                        success_callback(data);
                    }
                }
                else {
                    if (fail_callback) {
                        data['responseJSON'] = data;
                        fail_callback(data);
                    }
                }
            }
        );
    }
    //--Public Variables--//
    this.api_url = "/";
    this.api_timeout = 10000;
    //--Public Functions--//
    this.mode = function () {
        return mode;
    }
    this.status = function (params,success_callback,fail_callback) {
        status(
            params,
            function(data,status=null,xhr=null) {
                if (params.hasOwnProperty('color')) {
                    cur_states[params['color']] = data.state;
                }
                else {
                    cur_states = data.state;
                }
                if (success_callback) {
                    success_callback(data,status,xhr);
                }
            },
            fail_callback
        );
    }
    this.poll = function (success_callback,fail_callback) {
        poll(success_callback,fail_callback);
    }
    this.intervals = function (color,success_callback,fail_callback) {
        intervals(color,success_callback,fail_callback);
    }
    this.new_interval = function (color,interval_details,success_callback,fail_callback) {
        new_interval(color,interval_details,success_callback,fail_callback);
    }
    this.update_interval = function (color,interval_id,interval_details,success_callback,fail_callback) {
        update_interval(color,interval_id,interval_details,success_callback,fail_callback);
    }
    this.delete_interval = function (color,interval_id,success_callback,fail_callback) {
        delete_interval(color,interval_id,success_callback,fail_callback);
    }
    this.light = function (color,state,brightness,override_intervals,success_callback,fail_callback) {
        light(
            color,
            state,
            brightness,
            override_intervals,
            function (data,status=null,xhr=null) {
                cur_states[color] = {
                    on: (state == "on") ? true : false,
                    brightness: parseInt(brightness),
                    override_intervals: override_intervals
                };
                if (success_callback) {
                    success_callback(data,status,xhr);
                }
            },
            fail_callback
        );
    }
    this.switch_mode = function (apimode) {
        _switch_mode(apimode);
        if (apimode == "websocket") {
            _connect_websocket();
        }
    }
    //--Logic to construct the object--//
    if (opts.api_url) {
        this.api_url = opts.api_url;
        _api_url = opts.api_url;
    }
    if (opts.api_timeout) {
        this.api_timeout = opts.api_timeout;
        _api_timeout = opts.api_timeout;
    }
    url = _getLocation(this.api_url);
    if (opts.api_mode) {
        mode_forced = true;
        _switch_mode(opts.api_mode);
    }
    else {
        //Start with "rest" mode, and upgrade to websocket if avail
        _switch_mode("rest");
    }
    //Attempt upgrade to websocket
    _connect_websocket();
}

//To help with Websocket connections
function WebsocketHelper(api_url,callback_timeout) {
    //Set up private vars and default values
    var cb_map = {};
    var intervals = {};
    var ws_api_url = 'ws://' + $(location).attr('host') + '/';
    var api_callback_timeout = 10000;
    var connected = false;
    var connect_running = false;
    var connect_running_cnt = 0;
    var socket = null;
    var checkIntervalId = null;
    var onmessage = function(evt) {return};
    var onopen = function(evt) {return};
    var onclose = function(evt) {return};
    var onerror = function(evt) {return};
    var _clearCBTimeout = function (id) {
        clearTimeout(intervals[id]);
        delete(intervals[id]);
        cb_map[id]({
            data: JSON.stringify({
                mid: id,
                data: {
                    result: 'Failed',
                    msg: 'Failed: API Timeout',
                }
            })
        });
        delete(cb_map[id]);
    }
    var _process_message = function (evt) {
        var data = JSON.parse(evt.data);
        if (! data) {
            data = evt.data;
        }
        if (data.hasOwnProperty('mid')) {
            var message_id = data['mid'];
            if (cb_map.hasOwnProperty(message_id)) {
                cb_map[message_id](data);
                delete(cb_map[message_id]);
                clearTimeout(intervals[message_id]);
                delete(intervals[message_id]);
            }
        }
        else {
            onmessage(evt);
        }
    }
    var _connect = function (init) {
        if (connect_running) {
            if (connect_running_cnt <= 1 ) {
                connect_running_cnt += 1;
                return;
            }
            else {
                connect_running_cnt = 0;
            }
        }
        connect_running = true;
        if (! navigator.onLine) {
            console.log("Websocket, can't connect... Please connect to the Internet and try again");
            return;
        }
        socket = new WebSocket(ws_api_url);
        socket.onopen = function(evt) {
            connected = true;
            console.log("Websocket connected: " + socket.url);
            if (init) {
                //Check our websocket is connected every 5 seconds.
                checkIntervalId = setInterval(_check,5000);
                connect_running = false;
                connect_running_cnt = 0;
            }
            onopen(evt);
        };
        socket.onerror = function(evt) {
            if (connect_running) {
                connect_running = false;
                connect_running_cnt = 0;
            }
            onerror(evt);
        };
        socket.onmessage = _process_message;
        socket.onclose = onclose;
    }
    var _check = function () {
        if (socket.readyState >= 3) {
            connected = false;
            console.log("Reconnecting to websocket...");
            _connect();
        }
    }
    //Set up Public vars
    this.connect = _connect;
    this.onmessage = function (f) {
        onmessage=f;
    }
    this.onclose = function (f) {
        onclose=f;
    }
    this.onerror = function (f) {
        onerror=f;
    }
    this.onopen = function(f) {
        onopen=f;
    }
    this.connected = function () {
        return connected;
    }
    this.send = function(data,callback) {
        var payload = { data: data };
        if (callback) {
            var mid = performance.now();
            if (mid in cb_map) {
                mid+=1;
            }
            payload['mid'] = mid;
            cb_map[mid] = callback;
            intervals[mid] = setTimeout(_clearCBTimeout,api_callback_timeout,mid);
        }
        _check();
        if (socket.readyState != socket.OPEN) {
            var err_data = {
                result: 'Failed',
                msg: 'Failed: WebSocket is currently not connected, try again later'
            }
            if (mid) {
                err_data['mid'] = mid;
            }
            _process_message({
                data: JSON.stringify(err_data)
            });
        }
        else {
            socket.send(
                JSON.stringify(payload)
            );
        }
    }
    this.close = function (arg) {
        socket.close(arg);
        clearInterval(checkIntervalId);
        checkIntervalId = null;
    }
    //Override default values
    if (api_url) {
        ws_api_url = api_url;
    }
    if (callback_timeout) {
        api_callback_timeout = callback_timeout;
    }
    //Set up our websocket
    if ("WebSocket" in window) {
        _connect(true);
    }
    else {
        throw "Websocket not supported";
    }
}

//-- For Building the UI --//

function addBrightnessChangeRow(time,brightness,elem) {
    var t = "";
    var b = "";
    var uniq_id = (new Date).getTime();
    if (time) {
        t = time;
    }
    if (brightness) {
        b = brightness;
    }
    var $row = $([
    '<div id="' + uniq_id + '_row" class="col-sm-12 edit_brightness_changes">',
    '   <label class="col-sm-1"> At:</label>',
    '   <div class="col-sm-2">',
    '      <input type="text" class="form-control clockpicker edit_brightness_changes_time" value="' + t + '">',
    '   </div>',
    '   <label class="col-sm-3"> Brightness: </label>',
    '   <div class="col-sm-1">',
    '      <input type="text" class="edit_brightness_changes_br" value="' + b + '" />',
    '   </div>',
    '   <div class="col-sm-1 pull-right">',
    '       <a id="' + uniq_id + '_link" href="#" class="" onclick="removeBrightnessChangeRow(this)">',
                 '           <span class="glyphicon glyphicon-remove"></span>',
                 '       </a>',
                 '   </div>',
                 '</div>'
    ].join('\n'));
    if (elem) {
        $(elem).append($row);
        $('.clockpicker').clockpicker({
            donetext: 'Done',
            autoclose: true
        });
    }
    else {
        return $row;
    }
}

function addIntervalRow(color,interval_id,interval,elem) {
    var brightness_changes_str = "None";
    var brightness_changes = interval['brightness_change_at'];
    if ( Object.keys(brightness_changes).length > 0 ) {
        brightness_changes_str = "";
        for (var key in brightness_changes) {
            if(brightness_changes.hasOwnProperty(key)) {
                brightness_changes_str += 'Time: <strong>' + key + '</strong> Brightness: ' + '<span style="color:#f6931f; font-weight:bold;">' + brightness_changes[key] + "</span><br />";
            }
        }
    }
    var $row = $([
    '<div class="row" id="' + color + '_interval_config_id_' + interval_id + '">',
    '   <div class="col-sm-1">',
    '       <strong>ID:</strong><br /> ',
    '       <input id="' + color + '_interval_id_' + interval_id + '" type="text" value="' + interval_id + '" readonly maxlength="2" size="2" style="border:0"/>',
    '   </div>',
    '   <div class="col-sm-2">',
    '       <strong>Interval:</strong><br /> ',
    '       <input id="' + color + '_interval_' + interval_id + '" type="text" value="' + interval['time_interval'] + '" readonly maxlength=14" size="14" style="border:0" />',
    '   </div>',
    '   <div class="col-sm-1">',
    '       <strong>Duration:</strong><br /> ',
    '       <input id="' + color + '_interval_dur_' + interval_id + '" type="text" value="' + interval['duration'][0] + "hrs " + interval['duration'][1] + 'mins" readonly maxlength="12" size="12" style="border:0"/>',
    '   </div>',
    '   <div class="col-sm-1">',
    '       <strong>Brightness:</strong><br />',
    '       <input id="' + color + '_interval_br_' + interval_id + '" type="text" value="' + interval['brightness'] + '" readonly maxlength=3" size="3" style="border:0" />',
    '   </div>',
    '   <div class="col-sm-3">',
    '       <strong>Brightness Changes at times:</strong><br /> ' + brightness_changes_str,
    '       <input id="' + color + '_interval_brchg_' + interval_id + '" type="textarea" value=\'' + JSON.stringify(brightness_changes) + '\' readonly hidden />',
                 '   </div>',
                 '   <div class="col-sm-1">',
                 '       <div class="btn-group">',
                 '          <button type="button" class="btn btn-default btn-sm dropdown-toggle" data-toggle="dropdown" aria-haspopup="true" aria-expanded="false">',
                 '              Actions<span class="caret"></span>',
                 '          </button>',
                 '          <ul class="dropdown-menu">',
                 '              <li>',
                 '                  <a href="#" onclick="editInterval(\'' + color + '\',\'' + interval_id + '\')">Edit</a>',
                 '              </li>',
                 '              <li>',
                 '                  <a href="#"onclick="deleteInterval(\'' + color + '\',\'' + interval_id + '\')">Delete</a>',
                 '              </li>',
                 '          </ul>',
                 '      </div>',
                 '   </div>',
                 '</div>',
    ].join("\n"));
    if (elem) {
        $(elem).append($row);
    }
    else {
        return $row;
    }
}

function buildLightStateUI(state) {
    for (var color in state) {
        var checked = "";
        var override_intervals = "";
        var brightness = state[color]['brightness'];
        var brightness_opt = "hidden";
        var light_toggle_opt = "disabled";
        if (state[color].on) {
            checked = "checked";
        }
        if (state[color].override_intervals) {
            override_intervals = "checked";
            brightness_opt = "";
            light_toggle_opt = "";
        }
        var $content = $([
        '<div id="status_light_' + color + '" class="panel panel-default">',
        '    <div class="panel-heading">',
        '        <div class="row panel-title">',
        '            <div class="col-sm-2">',
        '                State: ',
        '                <span class="glyphicon glyphicon-certificate"></span>',
        '                <input class="light_toggle_input" id="' + color + '_light_toggle" type="checkbox" ' + checked + ' ' + light_toggle_opt + ' />',
        '                <span class="glyphicon glyphicon-certificate" style="color:' + color + '"></span>',
        '            </div>',
        '            <div class="col-sm-2">',
        '                <a data-toggle="collapse" data-parent="#config_accordion" href="#' + color + '_interval_menu">Intervals<b class="caret"></b></a>',
        '            </div>',
        '            <div class="col-sm-2">',
        '                Override Intervals: ',
        '                <input class="state_override_input" id="' + color + '_state_override" ' + override_intervals + ' type="checkbox" />',
        '            </div>',
        '            <div class="col-sm-2">',
        '                Brightness: <input class="state_override_brightness_input" id="' + color + '_state_override_brightness" maxlength="3" size="3" type="text" readonly style="border:0; color:#f6931f; font-weight:bold;" value="' + brightness + '"/>',
        '                <div id="' + color + '_brightness_slider" class="' + brightness_opt +'"></div>',
        '            </div>',
        '        </div>',
        '    </div>',
        '    <div id="' + color + '_interval_menu" class="panel-collapse collapse">',
        '        <div class="panel-body" id="' + color + '_intervals">',
        '        </div>',
        '    </div>',
        '</div>'
        ].join("\n"));
        //Add the color and a state for the various event handlers we'll be creating
        //this is so that the handler can check if it should actually run. So that events
        //that update UI elements don't cause excess API calls etc...
        ui_event_state[color] = {};
        ui_event_state[color]['active'] = true;
        ui_event_state[color]['light_toggle'] = {};
        ui_event_state[color]['light_toggle']['change'] = true;
        ui_event_state[color]['brightness_slider'] = {};
        ui_event_state[color]['brightness_slider']['slide'] = true;
        ui_event_state[color]['brightness_slider']['slidechange'] = true;
        ui_event_state[color]['state_override'] = {};
        ui_event_state[color]['state_override']['change'] = true;
        //Append our content
        $("#config_accordion").append($content)
        //Add toggle to the color's checkbox state
        $('#' + color + '_light_toggle').bootstrapToggle();
        //Add Brightness Slider
        $("#" + color + "_brightness_slider").slider({
            range: "min",
            value: brightness,
            min: 0,
            max: 255
        });
        //Add event handlers
        $('#' + color + '_light_toggle').change(function(event) {
            var color = this.id.split("_")[0];
            if ( ui_event_state[color]['active'] ) {
                if ( ui_event_state[color]['light_toggle'][event.type] ) {
                    lightStateUIUpdated(color,"light_toggle");
                }
            }
        });
        $("#" + color + "_brightness_slider").on("slide",function (event,ui) {
            var c = this.id.split("_")[0];
            $("#" + c + "_state_override_brightness").val(ui.value);
        });
        $("#" + color + "_brightness_slider").on("slidechange",function (event,ui) {
            var color = this.id.split("_")[0];
            if ( ui_event_state[color]['active'] ) {
                if ( ui_event_state[color]['brightness_slider'][event.type] ) {
                    lightStateUIUpdated(color,"brightness");
                }
            }
        });
        $('#' + color + '_state_override').change(function(event) {
            var color = this.id.split("_")[0];
            var ltoggle = '#' + color + '_light_toggle';
            var soverride = "#" + this.id;
            if ( $(soverride).is(':checked') ) {
                $(ltoggle).bootstrapToggle('enable');
                $('#' + color + '_brightness_slider').removeClass("hidden");
                $('#' + color + '_brightness_slider').show();
            }
            else {
                $(ltoggle).bootstrapToggle('disable');
                $('#' + color + '_brightness_slider').hide();
                $('#' + color + '_brightness_slider').addClass("hidden");
            }
            if ( ui_event_state[color]['active'] ) {
                if ( ui_event_state[color]['state_override'][event.type] ) {
                    lightStateUIUpdated(
                        color,
                        "override",
                        function() {
                            tclock.poll(
                                function() {
                                    tclock.status(
                                        {'color': color, 'intervals': false},
                                        function (data) {
                                            updateLightStateUI(data.state,color)
                                        }
                                    );
                                }
                            );
                        }
                    );
                }
            }
        });
    }
}

function buildLightIntervalUI(intervals) {
    for (var color in intervals) {
        var intervals_elem = "#" + color + "_intervals";
        var intervals_list = "#" + color + "_intervals_list";
        var color_intervals = intervals[color];
        var interval_cnt = color_intervals.length;
        $(intervals_elem).append($([
        '   <div id="' + color + '_intervals_list" class="col-sm-12">',
        '   </div>'
        ].join('\n'))
        );
        for (var i = 0; i < interval_cnt; i++) {
            var interval = intervals[color][i];
            addIntervalRow(color,i,interval,intervals_list);
        }
        $(intervals_elem).append($([
        '   <div class="row">',
        '       <a href="#" class="btn btn-default btn-xs" onclick="createInterval(\'' + color + '\')">Add Interval</a>',
                                   '   </div>'
        ].join('\n'))
        );
    }
}

function buildUI(data) {
    buildLightStateUI(data.state);
    buildLightIntervalUI(data.intervals);
}

function initializeState(d,callback) {
    if (d) {
        buildUI(d)
    }
    else {
        tclock.status("",
            function (data) {
                buildUI(data);
                if (callback) {
                    callback(data);
                }
            },
            function (jqXhr, textStatus, errorMessage) {
                var msg = "";
                if (jqXhr.responseJSON) {
                    msg = jqXhr.responseJSON.msg;
                }
                else {
                    msg = jqXhr.responseText;
                }
                bootbox.alert("ERROR getting status of clock: <hr />" + msg);
            }
        );
    }
}

function intervalDialogContent(interval_details) {
    var brightness_changes_menu = [];
    for (var time in interval_details['brightness_changes']) {
        brightness_changes_menu.push(addBrightnessChangeRow(time,interval_details['brightness_changes'][time]).prop('outerHTML'));
    }
    var $content = $([
    '   <div class="row">',
    '       <label id="edit_from_time" class="col-sm-3">From:</label>',
    '       <div class="col-sm-3 input-group clockpicker">',
    '           <input id="edit_from_time_input" type="text" class="form-control" value="' + interval_details['from_time'] + '">',
    '           <span class="input-group-addon">',
    '               <span class="glyphicon glyphicon-time"></span>',
    '           </span>',
    '       </div>',
    '   </div>',
    '   <div class="row">',
    '       <label id="edit_to_time" class="col-sm-3">To:</label>',
    '       <div class="col-sm-3 input-group clockpicker">',
    '           <input id="edit_to_time_input" type="text" class="form-control" value="' + interval_details['to_time'] + '">',
    '           <span class="input-group-addon">',
    '               <span class="glyphicon glyphicon-time"></span>',
    '           </span>',
    '       </div>',
    '   </div>',
    '   <div class="row">',
    '       <label id="edit_brightness" class="col-sm-3">Brightness:</label>',
    '       <input id="edit_brightness_input" type="text" value="' + interval_details['brightness'] + '" />',
    '   </div>',
    '   <hr />',
    '   <label class="col-sm-12">Brightness Changes</label>',
    '   <div id="edit_brightness_changes" class="row">',
    brightness_changes_menu.join('\n'),
                     '   </div>',
                     '   <div class="row">',
                     '       <a id="edit_add_brightness_input" href="#" class="btn btn-default btn-xs" onclick="addBrightnessChangeRow(\'\',\'\',\'#edit_brightness_changes\')">Add Row</a>',
                     '   </div>'
    ].join("\n"));
    return $content;
}

function removeBrightnessChangeRow(triggered_elem) {
    var uniq_id = triggered_elem.id.split("_")[0];
    $("#" + uniq_id + "_row").remove();
}

//-- UI Events/Actions --//
function createInterval(color) {
    var interval_details = {
        'from_time': "",
        'to_time': "",
        'brightness': 0,
        'brightness_changes': {}
    }
    var content = intervalDialogContent(interval_details);
    bootbox.confirm({
        'message': content,
        'title': 'Create Interval for color: ' + color,
        'buttons': {
            'confirm': {
                'label': 'Submit',
            }
        },
        callback: function(result) {
            if (!result) {
                return;
            }
            var new_interval_details = {
                'from_time': $("#edit_from_time_input").val(),
                    'to_time': $("#edit_to_time_input").val(),
                    'brightness': $("#edit_brightness_input").val()
            };
            var brightness_changes = {}
            var bchanges = $(".edit_brightness_changes");
            var bchanges_cnt = bchanges.length;
            for (var i = 0; i < bchanges_cnt; i++) {
                var btime = bchanges[i].children[1].children[0].value;
                var bbr = bchanges[i].children[3].children[0].value;
                if (btime && bbr) {
                    brightness_changes[btime] = bbr;
                }
            }
            new_interval_details['brightness_changes'] = brightness_changes;
            tclock.new_interval(
                color,
                new_interval_details,
                function (data) {
                    //var updated_ui_row = addIntervalRow(color,data.interval_id,data.interval_settings);
                    //$("#" + color + "_intervals_list").append(updated_ui_row.prop("outerHTML"));
                    tclock.status(
                        {'color': color, 'intervals': false},
                        function (data) {
                            updateLightStateUI(data.state,color)
                        }
                    );
                },
                function(jqXhr, textStatus, errorMessage) {
                    var msg = "";
                    if (jqXhr.responseJSON) {
                        msg = jqXhr.responseJSON.msg;
                    }
                    else {
                        msg = jqXhr.responseText;
                    }
                    bootbox.alert('ERROR Creating Interval for color: ' + color + ': <hr />' + msg);
                }
            );
        }
    });
    $('.clockpicker').clockpicker({
        donetext: 'Done',
        autoclose: true
    });
}

function deleteInterval(color,interval_id) {
    bootbox.confirm({
        'message': 'This will <strong>DELETE</strong> Interval: ' + interval_id + ' From color: ' + color,
        'callback': function(result) {
            if (result == true) {
                tclock.delete_interval(
                    color,
                    interval_id,
                    function(data,status,xhr) {
                        $('#' + color + '_interval_config_id_' + interval_id).remove();
                        tclock.status(
                            {'color': color, 'intervals': false},
                            function (data) {
                                updateLightStateUI(data.state,color)
                            }
                        );
                    },
                    function(jqXhr, textStatus, errorMessage) {
                        var msg = "";
                        if (jqXhr.responseJSON) {
                            msg = jqXhr.responseJSON.msg;
                        }
                        else {
                            msg = jqXhr.responseText;
                        }
                        bootbox.alert('ERROR Deleting Interval: ' + interval_id + ' From color: ' + color + ': <hr />' + msg);
                    }
                );
            }
        },
        'buttons': {
            'confirm': {
                'label': '<i class="fa fa-check"></i> Delete'
            }
        }
    });
}

function editInterval(color,interval_id) {
    var interval = $('#' + color + '_interval_' + interval_id).val().split(" => ");
    var interval_details = {
        'from_time': interval[0],
        'to_time': interval[1],
        'brightness': $('#' + color + '_interval_br_' + interval_id).val(),
        'brightness_changes': JSON.parse($('#' + color + '_interval_brchg_' + interval_id).val())
    }
    var content = intervalDialogContent(interval_details);
    bootbox.confirm({
        'message': content,
        'title': 'Edit Interval: ' + interval_id + ' in color: ' + color,
        'buttons': {
            'confirm': {
                'label': 'Submit',
            }
        },
        callback: function(result) {
            if (!result) {
                return;
            }
            var new_interval_details = {
                'from_time': $("#edit_from_time_input").val(),
                'to_time': $("#edit_to_time_input").val(),
                'brightness': $("#edit_brightness_input").val()
            };
            var brightness_changes = {}
            var bchanges = $(".edit_brightness_changes");
            var bchanges_cnt = bchanges.length;
            for (var i = 0; i < bchanges_cnt; i++) {
                var btime = bchanges[i].children[1].children[0].value;
                var bbr = bchanges[i].children[3].children[0].value;
                if (btime && bbr) {
                    brightness_changes[btime] = bbr;
                }
            }
            new_interval_details['brightness_changes'] = brightness_changes;
            tclock.update_interval(
                color,
                interval_id,
                new_interval_details,
                function (data) {
                    //var updated_ui_row = addIntervalRow(color,interval_id,data['new_interval_settings']);
                    //$("#" + color + "_interval_config_id_" + interval_id).replaceWith(updated_ui_row.prop("outerHTML"));
                    tclock.status(
                        {'color': color, 'intervals': false},
                        function (data) {
                            updateLightStateUI(data.state,color)
                        }
                    );
                },
                function(jqXhr, textStatus, errorMessage) {
                    var msg = "";
                    if (jqXhr.responseJSON) {
                        msg = jqXhr.responseJSON.msg;
                    }
                    else {
                        msg = jqXhr.responseText;
                    }
                    bootbox.alert('ERROR Updating Interval: ' + interval_id + ' From color: ' + color + ': <hr />' + msg);
                }
            );
        }
    });
    $('.clockpicker').clockpicker({
        donetext: 'Done',
        autoclose: true
    });
}

function lightStateUIUpdated(color,triggered_from,success_callback,fail_callback) {
    var ltoggle = '#' + color + '_light_toggle';
    var state = "";
    var brightness = $("#" + color + "_state_override_brightness").val();
    var override_intervals = $("#" + color + "_state_override").is(':checked');

    if ( $(ltoggle).is(":checked") ) {
        state = "on";
    }
    else {
        state = "off";
    }
    if (triggered_from == "light_toggle") {
        if (state == "on") {
            if (brightness == 0) {
                ui_event_state[color]['brightness_slider']['slidechange'] = false;
                $("#" + color + "_brightness_slider").slider("value",255);
                $("#" + color + "_state_override_brightness").val(255);
                ui_event_state[color]['brightness_slider']['slidechange'] = true;
                brightness = 255;
            }
        }
        else {
            ui_event_state[color]['brightness_slider']['slidechange'] = false;
            $("#" + color + "_brightness_slider").slider("value",0);
            $("#" + color + "_state_override_brightness").val(0);
            ui_event_state[color]['brightness_slider']['slidechange'] = true;
            brightness = 0;
        }
    }

    if (triggered_from == "brightness") {
        if (brightness == 0) {
            if (state == "on") {
                state = "off";
                ui_event_state[color]['light_toggle']['change'] = false;
                $(ltoggle).bootstrapToggle('off');
                ui_event_state[color]['light_toggle']['change'] = true;
            }
        }
        else {
            state = "on";
            ui_event_state[color]['light_toggle']['change'] = false;
            $(ltoggle).bootstrapToggle('on');
            ui_event_state[color]['light_toggle']['change'] = true;
        }
    }
    tclock.light(
        color,
        state,
        brightness,
        override_intervals,
        function (data,status,xhr) {
            if (success_callback) {
                success_callback(data,status,xhr,color,state,brightness,override_intervals);
            }
        },
        function(jqXhr, textStatus, errorMessage) {
            var msg = "";
            if (jqXhr.responseJSON) {
                msg = jqXhr.responseJSON.msg;
            }
            else {
                msg = jqXhr.responseText;
            }
            bootbox.alert("ERROR: <hr />" + msg);
            if (fail_callback) {
                fail_callback(jqXhr,textStatus,errorMessage,color,state,brightness,override_intervals);
            }
        }
    )
}

function refreshStatesUI() {
    tclock.status("",
        function(data) {
            updateLightStateUI(data.state);
            updateIntervalUI(data.intervals)
        },
        function (jqXhr, textStatus, errorMessage) {
            var msg = "";
            if (jqXhr.responseJSON) {
                msg = jqXhr.responseJSON.msg;
            }
            else {
                msg = jqXhr.responseText;
            }
            bootbox.hideAll();
            bootbox.alert("ERROR getting status of clock: <hr />" + msg);
        }
    );
}

function screenModeClick() {
    if (screen_mode == "off") {
        screen_mode = "on";
        console.log("Enabling Screen Mode, and disabling screen sleep");
        $('#screen_mode_toggle').val("On");
        noSleep.enable();
    }
    else {
        screen_mode = "off";
        console.log("Disabling Screen mode, re-enabling screen sleep");
        $('#screen_mode_toggle').val("Off");
        noSleep.disable();
    };
    toggleFullScreen();
    setScreenMode(screen_mode);
}

function updateIntervalUI(intervals) {
    for (color in intervals) {
        var ilen = intervals[color].length;
        $('#' + color + '_intervals').empty();
    }
    buildLightIntervalUI(intervals);
}

function updateLightStateElems(state,color) {
    var ui_state = !!$('#' + color + '_light_toggle').is(':checked');
    var ui_override = !!$('#' + color + '_state_override').is(':checked');
    var ui_brightness = $('#' + color + '_state_override_brightness').val();

    if (ui_state != state.on) {
        var state_txt = '';
        if (state.on) {
            state_txt = 'on';
        }
        else {
            state_txt = 'off';
        }
        ui_event_state[color]['light_toggle']['change'] = false;
        $('#' + color + '_light_toggle').bootstrapToggle('enable');
        $('#' + color + '_light_toggle').bootstrapToggle(state_txt);
        $('#' + color + '_light_toggle').bootstrapToggle('disable');
        ui_event_state[color]['light_toggle']['change'] = true;
    }
    if (ui_override != state.override_intervals) {
        $('#' + color + '_state_override').prop('checked',state.override_intervals)
        ui_override = state.override_intervals;
    }
    if (ui_brightness != state.brightness) {
        ui_event_state[color]['brightness_slider']['slidechange'] = false;
        $("#" + color + "_brightness_slider").slider("value",state.brightness);
        $("#" + color + "_state_override_brightness").val(state.brightness);
        ui_event_state[color]['brightness_slider']['slidechange'] = true;
    }
    //Set the light on/off toggle correctly enabled/disabled based on override_intervals value
    ui_event_state[color]['light_toggle']['change'] = false;
    if (state.override_intervals) {
        $('#' + color + '_light_toggle').bootstrapToggle('enable');
        $('#' + color + '_brightness_slider').removeClass("hidden");
        $('#' + color + '_brightness_slider').show();
    }
    else {
        $('#' + color + '_light_toggle').bootstrapToggle('disable');
        $('#' + color + '_brightness_slider').hide();
        $('#' + color + '_brightness_slider').addClass("hidden");
    }
    ui_event_state[color]['light_toggle']['change'] = true;
}

function updateLightStateUI(states,c) {
    if (screen_mode == 'on'){
        setScreenColor();
    }
    if(states.hasOwnProperty('on')) {
        updateLightStateElems(states,c);
    }
    else {
        for (var color in states) {
            updateLightStateElems(states[color],color);
        }
    }
}

//-- Utilities --//
function mixColors(color1, color2, amount) {
    //This is based pretty heavily on tinycolor.mix found here:
    //https://github.com/bgrins/TinyColor
    amount = (amount === 0) ? 0 : (amount || 50);

    var rgb1 = {
        r: color1[0],
        g: color1[1],
        b: color1[2],
        a: color1[3],
    }
    var rgb2 = {
        r: color2[0],
        g: color2[1],
        b: color2[2],
        a: color2[3],
    }

    var p = amount / 100;
    var rgba = {
        r: parseInt(((rgb2.r - rgb1.r) * p) + rgb1.r),
        g: parseInt(((rgb2.g - rgb1.g) * p) + rgb1.g),
        b: parseInt(((rgb2.b - rgb1.b) * p) + rgb1.b),
        a: ((rgb2.a - rgb1.a) * p) + rgb1.a
    };
    return [rgba.r,rgba.g,rgba.b,rgba.a];
}

function mixColorsMulti(color_list) {
    var mixed_color
    while (color = color_list.shift()) {
        if (!mixed_color) {
            mixed_color = color;
            color = color_list.shift()
            if (!color) {
                //console.log("Returning (mid) color: '"+mixed_color+"'");
                return mixed_color;
                break
            }
        }
        //console.log("Mixing color: '"+mixed_color+"' with '"+color);
        mixed_color = mixColors(mixed_color,color);
    }
    //console.log("Returning (end) color: '"+mixed_color+"'");
    return mixed_color;
}

function setScreenColor() {
    var rgb_colors = {
        blue:   [0,0,255,1],
        green:  [0,255,0,1],
        orange: [255,128,0,1],
        red:    [255,0,0,1],
        white:  [0,0,0,0,1],
        yellow: [255,255,0,1]
    };
    var black = [0,0,0,1];
    var blended_color = [black]; //default to black ("off")
    var bness_total = 0;
    var bness_avg;
    var bness_rev;
    var colors_to_combine = [];
    for (var color in cur_states) {
        if (cur_states[color]['on']) {
            var c_rgb = rgb_colors[color];
            //Caclulate alpha
            //c_rgb.push(1-cur_states[color]['brightness']/255/4);
            //c_rgb.push(1);
            bness_total += cur_states[color]['brightness'];
            colors_to_combine.push(c_rgb);
        }
    }
    if (colors_to_combine.length >= 1) {
        bness_avg = bness_total/colors_to_combine.length;
        blended_color = mixColorsMulti(colors_to_combine);
        //For now, ignore "brightness" for "Screen light"
        //if (bness_avg < 254) {
        //    bness_avg = parseInt(bness_avg/2);
        //    blended_color = mixColorsMulti([blended_color,[bness_avg,bness_avg,bness_avg,1]]);
        //}
    }
    $('#body').animate({backgroundColor: "rgba("+blended_color.join(',')+")"}, 'slow');
}

function setScreenMode(mode) {
    if (mode == "on") {
        $('#config_accordion').fadeOut("slow");
        $('#api_mode_toggle_div').fadeOut("slow");
        setScreenColor();
    }
    else {
        $('#config_accordion').fadeIn("slow");
        $('#api_mode_toggle_div').fadeIn("slow");
        $('#body').animate({backgroundColor: 'white'}, 'slow');
    }
}

function toggleFullScreen() {
    var doc = window.document;
    var docEl = doc.documentElement;

    var requestFullScreen = docEl.requestFullscreen || docEl.mozRequestFullScreen || docEl.webkitRequestFullScreen || docEl.msRequestFullscreen;
    var cancelFullScreen = doc.exitFullscreen || doc.mozCancelFullScreen || doc.webkitExitFullscreen || doc.msExitFullscreen;

    if (screen_mode == "on") {
        requestFullScreen.call(docEl);
    }
    else {
        cancelFullScreen.call(doc);
    }
}


//-- Initialization --//
$(document).ready(function(){
    var restRefreshIntvl = null;
    noSleep = new NoSleep();
    //Create our main tclock object
    tclock = new ToddlerClock({
        message_process_map: {
            server_connected: function(data) {
                cur_states = data.state;
                for (var color in data.state) {
                    var brightness = data.state[color]['brightness'];
                    data.state[color]['brightness'] = parseInt(brightness);
                }
                if (!ui_initialized) {
                    if (!ui_initializing) {
                        ui_initializing = true;
                        initializeState(data);
                        ui_initialized = true;
                        ui_initializing = false;
                    }
                }
                else {
                    updateLightStateUI(data.state);
                    updateIntervalUI(data.intervals);
                }
            },
            update_states: function (data) {
                if (data) {
                    for (var color in data) {
                        cur_states[color] = data[color];
                    }
                }
                updateLightStateUI(data);
            },
            update_intervals: updateIntervalUI
        },
        switch_callback: function(mode) {
            if (mode == "rest") {
                ui_event_state['api_mode'] = false;
                $("#api_mode_toggle").bootstrapToggle('off');
                ui_event_state['api_mode'] = true;
                if (!ui_initialized) {
                    if (!ui_initializing) {
                        ui_initializing = true;
                        initializeState(
                            "",
                            function() {
                                ui_initialized = true;
                                ui_initializing = false;
                            }
                        );
                    }
                }
                restRefreshIntvl = setInterval(refreshStatesUI,60000); //Check for status changes every 60mins
            }
            else if (mode == "websocket") {
                ui_event_state['api_mode'] = false;
                $("#api_mode_toggle").bootstrapToggle('on');
                ui_event_state['api_mode'] = true;
                clearInterval(restRefreshIntvl);
                restRefreshIntvl = null;
            }
            else {
                console.log("Unknown ToddlerClock mode: " + mode);
            }
        }
    });
    
    //Event handler for api mode toggle
    $('#api_mode_toggle').change(function(event) {
        if (ui_event_state['api_mode']) {
            if ($('#api_mode_toggle').is(":checked")) {
                tclock.switch_mode("websocket")
            }
            else {
                tclock.switch_mode("rest")
            }
        }
    });
});
