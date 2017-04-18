//Global vars
tclock = null;
ui_event_state = {};

//Main Prototype for interacting with the clock
function ToddlerClock(api_url,api_timeout) {
    if (api_url) {
        this.api_url = api_url;
    }
    else {
        this.api_url = "/";
    }
    if (api_timeout) {
        this.api_timeout = api_timeout;
    }
    else {
        this.api_timeout = 10000;
    }
    this.status = function (params,success_callback,fail_callback) {      
        $.ajax({
            type: "GET",
            url: this.api_url + "status",
            dataType: 'json',
            data: params,
            timeout: this.api_timeout,
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
    this.poll = function (success_callback,fail_callback) {      
        $.ajax({
            type: "GET",
            url: this.api_url + "poll",
            dataType: 'json',
            timeout: this.api_timeout,
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
    this.intervals = function (color,success_callback,fail_callback) {      
        var uri = "interval"
        if (color) {
            uri = uri + "/" + color;
        }
        $.ajax({
            type: "GET",
            url: this.api_url + uri,
            dataType: 'json',
            timeout: this.api_timeout,
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
    this.new_interval = function (color,interval_details,success_callback,fail_callback) {
        $.ajax({
            type: "POST",
            url:  this.api_url + 'interval/' + color,
            contentType: 'application/json',
            dataType: 'json',
            timeout: this.api_timeout,
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
    this.update_interval = function (color,interval_id,interval_details,success_callback,fail_callback) {
        $.ajax({
            type: "PUT",
            url: this.api_url + 'interval/' + color + "/" + interval_id,
            dataType: 'json',
            contentType: 'application/json',
            timeout: this.api_timeout,
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
    this.delete_interval = function (color,interval_id,success_callback,fail_callback) {
        $.ajax({
            type: "DELETE",
            url: this.api_url + 'interval/' + color + "/" + interval_id,
            dataType: 'json',
            contentType: 'application/json',
            timeout: this.api_timeout,
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
    this.light = function (color,state,brightness,override_intervals,success_callback,fail_callback) {
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
            url: this.api_url + 'light/' + color,
            dataType: 'json',
            contentType: 'application/json',
            timeout: this.api_timeout,
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
}

//-- For manipulating the UI --//
//Event Handlers and setup for the UI bits
$(document).ready(function(){
    tclock = new ToddlerClock();
    setInterval(refreshStatesUI,60000); //Check for status changes every 60mins
});

function initializeState() {
    tclock.status("",
        function (data) {
            buildUI(data);
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

function removeBrightnessChangeRow(triggered_elem) {
    var uniq_id = triggered_elem.id.split("_")[0];
    $("#" + uniq_id + "_row").remove();
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
                    var updated_ui_row = addIntervalRow(color,data.interval_id,data.interval_settings);
                    $("#" + color + "_intervals_list").append(updated_ui_row.prop("outerHTML"));
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
                    var updated_ui_row = addIntervalRow(color,interval_id,data['new_interval_settings']);
                    $("#" + color + "_interval_config_id_" + interval_id).replaceWith(updated_ui_row.prop("outerHTML"));
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

function buildUI(data) {
    buildLightStateUI(data.state);
    buildLightIntervalUI(data.intervals);
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
    if (ui_state != state.override_intervals) {
        $('#' + color + '_state_override').prop('checked',state.override_intervals)
    }
    if (ui_brightness != state.brightness) {
        ui_event_state[color]['brightness_slider']['slidechange'] = false;
        $("#" + color + "_brightness_slider").slider("value",state.brightness);
        $("#" + color + "_state_override_brightness").val(state.brightness);
        ui_event_state[color]['brightness_slider']['slidechange'] = true;
    }
}

function updateLightStateUI(states,c) {
    if(states.hasOwnProperty('on')) {
        updateLightStateElems(states,c);
    }
    else {
        for (var color in states) {
            updateLightStateElems(states[color],color);
        }
    }
}

function refreshStatesUI() {
    tclock.status("",
        function(data) {
            updateLightStateUI(data.state);
            for (color in data.intervals) {
                var ilen = data.intervals[color].length;
                $('#' + color + '_intervals').empty();
            }
            buildLightIntervalUI(data.intervals);
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







