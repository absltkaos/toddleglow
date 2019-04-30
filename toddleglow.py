#!/usr/bin/python

import arrow
import gevent.wsgi
import json
import sys
import signal
import os
import logging
from collections import OrderedDict
from flask import Flask, request, jsonify
from geventwebsocket import WebSocketServer, WebSocketApplication, Resource
from geventwebsocket.exceptions import WebSocketError

try:
    import piglow
    PIGLOW_ENABLED = True
except ImportError:
    PIGLOW_ENABLED = False

__version__ = '0.5.6'
DEFAULT_CONFIG_PATH = "./config.json"
CONFIG_PATH = ""
REAL_CONFIG_PATH = DEFAULT_CONFIG_PATH
DEFAULT_OPTS = {
    'api_listen': '0.0.0.0',
    'api_port': 8080,
    'api_rest': True,
    'api_rest_debug': False,
    'api_websocket': True,
    'intervals': {},
    'log_level': 'info',
    'piglow_enabled': PIGLOW_ENABLED,
    'time_zone': 'US/Mountain'
}
LOG_LEVEL = logging.INFO
LOGGING_LEVELS = {
    'debug': logging.DEBUG,
    'info': logging.INFO,
    'warning': logging.WARNING,
    'error': logging.ERROR,
    'critical': logging.CRITICAL,
    'notset': logging.NOTSET
}
SERVER_FUNC = gevent.wsgi.WSGIServer
CONFIG_FILE = None # This holds our config file object
CONFIG = {} # this holds our config dict
WSGI_APP = None #This holds our Flask app
APPS_RESOURCE = None
APP = None
RUNNING = True
CHANNELMSGR = None

##-Classes-##
class ToddlerClock:
    def __init__(self,time_zone,piglow_enabled,channel_com=None,logger=None):
        self.logger = logger or logging.getLogger("ToddlerClock")
        self.colors = ['blue', 'yellow', 'green', 'orange', 'white', 'red']
        self.timing = {}
        self.state = {}
        for c in self.colors:
            self.state[c] = {
                'on': False,
                'brightness': 0,
                'override_intervals': False
            }
            self.timing[c] = []
        self.channel_com = channel_com
        self.tz = time_zone
        self.piglow_enabled = piglow_enabled
        if piglow_enabled:
            piglow.auto_update = True
            piglow.clear();
    def _active_interval(self,color):
        active = None
        ind = 0
        for i in self.timing[color]:
            if i['time_interval'].now_in_interval():
                active = ind
            ind += 1
        return active
    def _human_keys(self,astr):
        keys=[]
        import re
        for elt in re.split('(\d+)', astr):
            elt=elt.swapcase()
            try: elt=int(elt)
            except ValueError: pass
            keys.append(elt)
        return keys
    def poll(self):
        cur_datetime = arrow.utcnow().to(self.tz)
        cur_time = cur_datetime.strftime("%H:%M")
        #self.logger.debug("{}: Checking light timing status".format(cur_datetime))
        for color in self.state:
            if self.state[color]['override_intervals']:
                continue
            ai = self._active_interval(color)
            if ai != None:
                #There is an active interval, act according to interval settings
                i = self.timing[color][ai]
                brightness = i['brightness']
                #Adjust find possible new brightness level
                if self.state[color]['on']:
                    bkeys = sorted(list(i['brightness_change_at']),key=self._human_keys)
                    bkeys.reverse()
                    for bt in bkeys:
                        ti = TimeInterval(bt,i['time_interval'].to_time)
                        if ti.now_in_interval():
                            del(ti)
                            brightness = i['brightness_change_at'][bt]
                            break
                if self.state[color]['brightness'] != brightness:
                    self.logger.info("Setting color: {} on and to brightness level: {}".format(color,brightness))
                    self.turn_on(color,brightness)
            else:
                #No active intervals, so turn off color if 'on'
                if self.state[color]['on']:
                    self.logger.info("Turning color: {} off".format(color))
                    self.turn_off(color)
    def turn_on(self,color,brightness=255,override_intervals=None):
        try:
            self.state[color]['on'] = True
            self.state[color]['brightness'] = brightness
            if self.piglow_enabled:
                piglow.colour(color,int(brightness))
            if override_intervals != None:
                if self.state[color]['override_intervals'] != override_intervals:
                    self.state[color]['override_intervals'] = override_intervals
            if self.channel_com:
                self.logger.info("ToddlerClock.turn_on() called, broadcasting possibly state changes to color: '{}'".format(color))
                self.channel_com.broadcast_to(
                    "status_changes",
                    json.dumps({
                        'command': 'update_states',
                        'data': {
                            color: dict(self.state[color])
                        }
                    })
                )
        except KeyError:
            raise ValueError("ERROR: unknown color: {}".format(color))
    def turn_off(self,color,override_intervals=None):
        try:
            if self.state[color]['on']:
                if self.piglow_enabled:
                    piglow.colour(color,0)
                self.state[color]['on'] = False
                self.state[color]['brightness'] = 0
            if override_intervals != None:
                if self.state[color]['override_intervals'] != override_intervals:
                    self.state[color]['override_intervals'] = override_intervals
            if self.channel_com:
                self.logger.info("ToddlerClock.turn_off() called, broadcasting possibly state changes to color: '{}'".format(color))
                self.channel_com.broadcast_to(
                    "status_changes",
                    json.dumps({
                        'command': 'update_states',
                        'data': {
                            color: dict(self.state[color])
                        }
                    })
                )
        except KeyError:
            raise ValueError("ERROR: unknown color: {}".format(color))
    def add_interval(self,color,from_time,to_time,brightness,brightness_changes=None,update_index=None):
        if color not in self.colors:
            raise ValueError("ERROR: unknown color: {}".format(color))
        for i in self.timing[color]:
            ti = i['time_interval']
            if ti.in_interval(from_time):
                raise ValueError("ERROR: color: {} 'from_time' is within interval: {}".format(color,ti))
            if ti.in_interval(to_time):
                raise ValueError("ERROR: color: {} 'to_time' is within interval: {}".format(color,ti))
        new_ti = TimeInterval(from_time,to_time)
        bc = brightness_changes
        if bc:
            for b in bc:
                if not new_ti.in_interval(b):
                    raise ValueError("ERROR: color: {} brightness_changes value {} is outside of interval desired interval".format(color,b))
        else:
            bc = {}
        new_interval = {
            'time_interval': new_ti,
            'brightness': brightness,
            'brightness_change_at': bc,
            'duration': new_ti.get_duration()
        }
        if update_index:
            self.timing[color].insert(update_index,new_interval)
        else:
            self.timing[color].append(new_interval)
        if self.channel_com:
            self.channel_com.broadcast_to(
                "status_changes",
                json.dumps({
                    'command': 'update_intervals',
                    'data': {
                        color: self.timing[color]
                    }
                },default=jsonizer)
            )
        self.poll()
    def update_interval(self,color,interval_id,from_time=None,to_time=None,brightness=None,brightness_changes=None):
        updates = False
        try:
            i = self.timing[color][interval_id]
        except IndexError:
            raise ValueError("ERROR: unknown interval_id: {}".format(interval_id))
        except KeyError:
            raise ValueError("ERROR: unknown color: {}".format(color))
        new_interval_settings = {
            'color': color,
            'update_index': interval_id,
            'brightness': i['brightness'],
            'from_time': i['time_interval'].from_time,
            'to_time': i['time_interval'].to_time,
            'brightness_changes': i['brightness_change_at']
        }
        if brightness:
            new_interval_settings['brightness'] = brightness
            updates = True
        if from_time:
            new_interval_settings['from_time'] = from_time
            updates = True
        if to_time:
            new_interval_settings['to_time'] = to_time
            updates = True
        if brightness_changes:
            new_interval_settings['brightness_changes'] = brightness_changes
            updates = True
        if updates:
            self.del_interval(color,interval_id)
            try:
                self.add_interval(**new_interval_settings)
            except:
                self.timing[color].insert(interval_id,i)
                raise
    def del_interval(self,color,interval_id):
        try:
            del(self.timing[color][interval_id])
            self.turn_off(color)
            if self.channel_com:
                self.channel_com.broadcast_to(
                    "status_changes",
                    json.dumps({
                        'command': 'update_intervals',
                        'data': {
                            color: self.timing[color]
                        }
                    },default=jsonizer)
                )
        except IndexError:
            return
        except KeyError:
            raise ValueError("ERROR: unknown color: {}".format(color))
    def get_interval(self,color,interval_id):
        try:
            return dict(self.timing[color][interval_id])
        except KeyError:
            raise ValueError("ERROR: unknown color: {}".format(color))
        except IndexError:
            raise ValueError("ERROR: unknown interval_id: {}".format(interval_id))
    def get_interval_ids(self,color=None):
        l = {}
        if color:
            ind = 0
            for i in self.timing[color]:
                l[ind] = i
                ind += 1
        else:
            for c in self.timing:
                l[c] = {}
                ind = 0
                for i in self.timing[c]:
                    l[c][ind] = i
                    ind += 1
        return dict(l)

class TimeInterval:
    def __init__(self,from_time,to_time):
        self.from_time = from_time
        self.to_time = to_time
        from_h,from_m = from_time.split(':')
        to_h,to_m = to_time.split(':')
        self.from_h = int(from_h)
        self.from_m = int(from_m)
        self.to_h = int(to_h)
        self.to_m = int(to_m)
        self.from_mins = self.from_h * 60 + self.from_m
        if self.to_h < self.from_h:
            self.to_mins = (self.to_h+24)*60 + self.to_m
        else:
            self.to_mins = self.to_h*60 + self.to_m
        self.dur_mins = self.to_mins - self.from_mins
        self.dur_h = int(self.dur_mins/60)
        self.dur_m = self.dur_mins%60
    def __repr__(self):
        return 'TimeInterval("{}","{}")'.format(self.from_time,self.to_time)
    def __str__(self):
        return '{} => {}'.format(self.from_time,self.to_time)
    def _toJSON(self):
        return self.__str__()
    def now_in_interval(self):
        cur_datetime = arrow.utcnow().to('US/Mountain')
        cur_time = cur_datetime.strftime("%H:%M")
        return self.in_interval(cur_time)
    def get_duration(self,ret_format=None):
        if ret_format == "mins":
            return self.dur_mins
        elif ret_format == "time":
            return "{:02d}:{:02d}".format(self.dur_h,self.dur_m)
        elif ret_format == "tuple":
            return (self.dur_h,self.dur_m)
        else:
            return (self.dur_h,self.dur_m)
    def in_interval(self,cur_time):
        cur_h,cur_m = cur_time.split(':')
        cur_h = int(cur_h)
        cur_m = int(cur_m)
        cur_mins = cur_h * 60 + cur_m
        if self.to_h < self.from_h and cur_h <= self.to_h:
            cur_mins = (cur_h+24)*60 + cur_m
        if cur_mins >= self.from_mins and cur_mins < self.to_mins:
            return True
        else:
            return False

class Channel():
    def __init__(self,name,members=None,logger=None):
        self.logger = logger or logging.getLogger("Channel:{}".format(name))
        self.name = name
        if members:
            self.members = members
        else:
            self.members = []
    def broadcast(self,msg):
        for m in self.members:
            self.logger.debug("Sending msg to member: {}, msg: {}".format(m.conn_info, msg))
            try:
                m.ws.send(msg)
            except WebSocketError:
                self.unsubscribe(m);
                pass
                #raise
    def subscribe(self,member):
        self.members.append(member)
        self.logger.debug("Member: {} subscribed".format(member.conn_info))
    def unsubscribe(self,member):
        self.members.remove(member)
        self.logger.debug("Member: {} Un-subscribed".format(member.conn_info))

class ChannelMgr():
    def __init__(self,logger=None):
        self.logger = logger or logging.getLogger("ChannelMgr")
        self.channels = {}
    def add_channel(self,name,members=None):
        self.logger.debug("Created new channel: {}".format(name))
        self.channels[name] = Channel(name,members)
    def broadcast(self,msg):
        self.logger.debug("Broadcasting to all channels, message: {}".format(msg))
        for c in self.channels:
            self.channels[c].broadcast(msg)
    def broadcast_to(self,channel,msg):
        self.logger.debug("Broadcasting to channel: {}, message: {}".format(channel,msg))
        self.channels[channel].broadcast(msg)
    def subscribe(self,channel,member):
        self.logger.debug("Subscribing Member: {} to channel: {}".format(member.conn_info,channel))
        self.channels[channel].subscribe(member)
    def unsubscribe(self,channel,member):
        self.logger.debug("UN-Subscribing Member: {} from channel: {}".format(member.conn_info,channel))
        self.channels[channel].unsubscribe(member)

class WebsocketApi(WebSocketApplication):
    def __init__(self, ws, logger=None):
        self.logger = logger or logging.getLogger("WebSocketAPI")
        self.protocol = self.protocol_class(self)
        self.ws = ws
        self.conn_info = "{}:{}".format(
            self.ws.environ.get('HTTP_X_REAL_IP',self.ws.environ['REMOTE_ADDR']),
            self.ws.environ['REMOTE_PORT']
        )
        self.cmds = {
            'status': self.status,
            'poll': self.poll,
            'get_intervals': self.get_intervals,
            'new_interval': self.new_interval,
            'update_interval': self.update_interval,
            'delete_interval': self.delete_interval,
            'change_light': self.change_light,
        }
        self.logger = LogContextAdapter(self.logger,{'context_data': self.conn_info})
        CHANNELMSGR.subscribe("status_changes",self)
    def on_open(self):
        self.logger.info("Connection opened")
        try:
            self.logger.debug("Gathering initial states for new connection")
            res = {
                'command': 'server_connected'
            }
            res['data'] = self.status()
            self.logger.debug("Sending initial states to new websocket connection: {}".format(res))
            self.ws.send(json.dumps(res,default=jsonizer))
        except WebSocketError:
            exc_type, exc_value, exc_traceback = sys.exc_info()
            self.logger.error("Error sending server_response 'Connected' msg:{}".format(exc_value),exc_info=True)
            self.ws.close_connection()
    def on_message(self, message):
        if message:
            processing_error = False
            self.logger.debug("Got Message (string repr): {}".format(message.__repr__()))
            mid = None
            m = json.loads(message)
            req = {}
            try:
                mid = m['mid']
            except KeyError:
                pass
            try:
                md = json.loads(m['data'])
                try:
                    cmd = md['command']
                except KeyError:
                    self.logger.error("Missing 'command' key in message data, data message was: {}".format(md))
                    res = {
                        'command': 'server_response',
                        'msg': 'Failed: Missing required attribute "command" in "data" object: "{}"'.format(md),
                        'result': 'Failed'
                    }
                    processing_error = True
            except KeyError:
                self.logger.error("Missing 'data' key in JSON message, raw message was: {}".format(message.__repr__()))
                res = {
                    'command': 'server_response',
                    'msg': 'Failed: Missing required JSON attribute: "data" for processing your message: "{}"'.format(message.__repr__()),
                    'result': 'Failed'
                }
                processing_error = True
            if not processing_error:
                self.logger.info("Recieved command: '{}', and data: {}".format(cmd,md))
                try:
                    res = self.cmds[cmd](**md)
                except KeyError:
                    res = {
                        "msg": "Failed: Unknown command: {}".format(cmd),
                        "result": "Failed"
                    }
                except:
                    exc_type, exc_value, exc_traceback = sys.exc_info()
                    res = {
                        'msg': 'Failed: {}'.format(exc_value),
                        'result': 'Failed'
                    }
                try:
                    t = res['command']
                except KeyError:
                    res['command'] = 'server_response'
            if mid:
                res['mid'] = mid
            try:
                self.logger.debug("Sending back response: {}".format(res))
                self.ws.send(json.dumps(res,default=jsonizer))
            except WebSocketError:
                exc_type, exc_value, exc_traceback = sys.exc_info()
                self.logger.error("Error sending server_response 'Connected' msg:{}".format(exc_value),exc_info=True)
                self.ws.close_connection()
    def on_close(self, reason):
        CHANNELMSGR.unsubscribe("status_changes",self)
        self.logger.info("Connection Closed")
    def status(self,state=True,intervals=True,color=None,**kwargs):
        self.logger.debug("Gathering light states")
        js = {
            'msg': 'Completed',
            'result': 'Success'
        }
        if color:
            if color not in tclock.colors:
                js['msg'] = "Unknown color:{}".format(get_color)
                js['result'] = "Failed"
        if state in ['t','true',True]:
            if color:
                js['state'] = tclock.state[color]
            else:
                js['state'] = tclock.state
        if intervals in ['t','true', True]:
            if color:
                js['intervals'] = tclock.timing[color]
            else:
                js['intervals'] = tclock.timing
        self.logger.debug("States gathered, responding with: {}".format(js))
        return js
    def poll(self,**kwargs):
        self.logger.debug("Executing Poll")
        tclock.poll();
        js = {
            'msg': 'Completed',
            'result': 'Success'
        }
        self.logger.debug("Poll completed, responding with: {}".format(js))
        return js
    def get_intervals(self,color=None,**kwargs):
        self.logger.debug("Gathering color change intervals")
        js = {}
        js['intervals'] = tclock.get_interval_ids(color)
        js['result'] = 'Success'
        js['msg'] = 'Completed'
        self.logger.debug("Color change intervals gathered, responding with: {}".format(js))
        return js
    def new_interval(self,color,interval_details,**kwargs):
        self.logger.debug("Preparing to create a new interval for color: {}, details: {}".format(color,interval_details))
        js = {
            'msg': '',
            'result': ''
        }
        interval_settings = { 'color': color }
        settings_reqd_keys = ['from_time','to_time','brightness']
        settings_opt_keys = ['brightness_changes']
        for rk in settings_reqd_keys:
            try:
                interval_settings[rk] = interval_details[rk]
            except KeyError:
                js['msg'] = 'Missing required key "{}"'.format(rk)
                js['result'] = "Failed"
                return js
        for ok in settings_opt_keys:
            try:
                interval_settings[ok] = interval_details[ok]
            except KeyError:
                pass
        try:
            self.logger.debug("Attempting to create a new interval with settings: {}".format(interval_settings))
            tclock.add_interval(**interval_settings)
            js['msg'] = "Created new interval"
            js['result'] = "Success"
            js['interval_id'] = len(tclock.timing[color]) - 1
            js['interval_settings'] = tclock.get_interval(color,js['interval_id'])
            js['interval_settings']['time_interval'] = jsonizer(js['interval_settings']['time_interval'])
            update_config()
        except:
            exc_type, exc_value, exc_traceback = sys.exc_info()
            self.logger.error("Error trying to create a new interval: {}".format(exc_value),exc_info=True)
            js['msg'] = 'Failed: {}'.format(exc_value)
            js['result'] = 'Failed'
        self.logger.debug("New interval processing done, responding with: {}".format(js))
        return js
    def update_interval(self,color,interval_id,interval_details,**kwargs):
        self.logger.debug("Preparing to update interval_id: {} for color: {} details: {}".format(interval_id,color,interval_details))
        js = {
            'msg': '',
            'result': ''
        }
        changes = False
        interval_settings = {
            'color': color,
        }
        settings_opt_keys = ['from_time','to_time','brightness','brightness_changes']
        try:
            i_id = int(interval_id)
            interval_settings['interval_id'] = int(interval_id)
        except:
            js['msg'] = 'Interval id must be an integer'
            js['result'] = 'Failed'
            return js
        for ok in settings_opt_keys:
            try:
                changes = True
                interval_settings[ok] = interval_details[ok]
            except KeyError:
                pass
        try:
            self.logger.debug("Attempting to update interval_id: {} for color: {} with details: {}".format(interval_id,color,interval_settings))
            tclock.update_interval(**interval_settings)
            js['msg'] = "Updated interval: {}:{}".format(color,interval_id)
            js['result'] = "Success"
            js['new_interval_settings'] = tclock.get_interval(color,int(interval_id))
            js['new_interval_settings']['time_interval'] = jsonizer(js['new_interval_settings']['time_interval'])
            update_config()
        except:
            exc_type, exc_value, exc_traceback = sys.exc_info()
            self.logger.error("Error trying to update interval_id: {} for color: {}: {}".format(interval_id,color,exc_value),exc_info=True)
            js['msg'] = 'Failed: {}'.format(exc_value)
            js['result'] = 'Failed'
        self.logger.debug("Update interval processing done, responding with: {}".format(js))
        return js
    def delete_interval(self,color,interval_id,**kwargs):
        self.logger.debug("Preparing to delete interval_id: {} for color: {}".format(interval_id,color))
        js = {
            'msg': '',
            'result': ''
        }
        try:
            i_id = int(interval_id)
        except:
            js['msg'] = 'Interval id must be an integer'
            js['result'] = 'Failed'
            return js
        try:
            self.logger.debug("Attempting to delete interval_id: {} for color: {}".format(interval_id,color))
            tclock.del_interval(color,i_id)
            js['msg'] = 'Deleted interval'
            js['result'] = 'Success'
            update_config()
        except:
            exc_type, exc_value, exc_traceback = sys.exc_info()
            self.logger.error("Error trying to delete interval_id: {} for color: {}: {}".format(interval_id,color,exc_value),exc_info=True)
            js['msg'] = 'Failed: {}'.format(exc_value)
            js['result'] = 'Failed'
        self.logger.debug("Delete interval processing done, responding with: {}".format(js))
        return js
    def change_light(self,color,state,brightness=None,override_intervals=False,**kwargs):
        self.logger.debug("Preparing to change light state for color: {} state: {} brightness: {}, override_intervals: {}".format(color,state,brightness,override_intervals))
        js = {
            'msg': '',
            'result': ''
        }
        try:
            state = state.lower()
        except KeyError:
            js['msg'] = 'Missing "state" key'
            js['result'] = "Failed"
            return js
        if state not in ['on','off']:
            js['msg'] = 'Invalid state: {}, must be one of :"on" or "off"'.format(state)
            js['result'] = 'Failed'
            return js
        if state == 'on':
            if brightness:
                brightness = int(brightness)
            else:
                brightness = 255
            self.logger.debug("Attempting to change light state for color 'on': {}".format(color))
            tclock.turn_on(color,brightness,override_intervals)
            js['msg'] = 'Turned color: {} ON'.format(color)
        if state == 'off':
            self.logger.debug("Attempting to change light state for color 'off': {}".format(color))
            tclock.turn_off(color,override_intervals)
            js['msg'] = 'Turned color: {} OFF'.format(color)
        js['result'] = 'Success'
        self.logger.debug("Change light state processing done, responding with: {}".format(js))
        return js

class LogContextAdapter(logging.LoggerAdapter):
    def process(self, msg, kwargs):
        return '[%s] %s' % (self.extra['context_data'], msg), kwargs

##-Helper functions-##

def sig_shutdown():
    global RUNNING
    logger.info("Signaling Shutdown")
    RUNNING = False

def jsonizer(obj):
    try:
        return obj._toJSON()
    except:
        return obj.__repr__()

def update_config():
    CONFIG['intervals'] = tclock.timing
    CONFIG_FILE.seek(0)
    CONFIG_FILE.truncate()
    CONFIG_FILE.write(json.dumps(CONFIG,indent=4,default=jsonizer))
    CONFIG_FILE.flush()

def init_rest_api():
    class RestLoggerPrepender:
        def __init__(self,logger):
            self.logger = logger
            self.warn = self.warning
            self.fatal = self.critical
        def _ctx(self):
            ips = (
                request.environ.get('HTTP_X_FORWARDED_FOR',False),
                request.environ.get('HTTP_X_REAL_IP',False),
                request.environ['REMOTE_ADDR'],
            )
            for ip in ips:
                if ip:
                    break
            return "{}:{}".format(
                ip,
                request.environ['REMOTE_PORT']
            )
        def _edit_msg(self,msg):
            return "[{}] {}".format(self._ctx(),msg)
        def critical(self, msg, *args, **kwargs):
            self.logger.critical(self._edit_msg(msg),*args, **kwargs)
        def debug(self, msg, *args, **kwargs):
            self.logger.debug(self._edit_msg(msg),*args, **kwargs)
        def error(self, msg, *args, **kwargs):
            self.logger.error(self._edit_msg(msg),*args, **kwargs)
        def exception(self, msg, *args, **kwargs):
            self.logger.exception(self._edit_msg(msg),*args, **kwargs)
        def info(self, msg, *args, **kwargs):
            self.logger.info(self._edit_msg(msg),*args, **kwargs)
        def warning(self, msg, *args, **kwargs):
            self.logger.warning(self._edit_msg(msg),*args, **kwargs)
        def log(self, level, msg, *args, **kwargs):
            self.logger.log(level,self._edit_msg(msg),*args, **kwargs)
    #Initialize Flask based API
    rest_app=Flask("RestAPI",static_folder="{}/static".format(os.getcwd()))
    #Set Flask debug if needed
    if CONFIG['api_rest_debug']:
        rest_app.debug = True
    #Our special log wrapper to prepending context info
    rest_app.log = RestLoggerPrepender(rest_app.logger)
    @rest_app.route("/")
    def root():
        return rest_app.send_static_file('index.html')
    @rest_app.route("/status")
    def status():
        rest_app.log.debug("Gathering light states")
        js = {
            'result': 'Success'
        }
        get_state = request.args.get('state', 't').lower()
        get_intervals = request.args.get('intervals', 't').lower()
        get_color = request.args.get('color','').lower()
        rest_app.log.info("Recieved command: 'status', and data: {{color: {}, state: {}, intervals: {}}}".format(get_color,get_state,get_intervals))
        if get_color:
            if get_color not in tclock.colors:
                js['msg'] = "Unknown color:{}".format(get_color)
                resp = jsonify(js)
                resp.status = 400
                return resp
        if get_state in ['t','true']:
            if get_color:
                js['state'] = tclock.state[get_color]
            else:
                js['state'] = tclock.state
        if get_intervals in ['t','true']:
            if get_color:
                js['intervals'] = tclock.timing[get_color]
            else:
                js['intervals'] = tclock.timing
        rest_app.log.debug("States gathered, responding with: {}".format(js))
        resp = rest_app.response_class(
            response=json.dumps(js,indent=4,default=jsonizer),
            status=200,
            mimetype='application/json'
        )
        return resp
    @rest_app.route("/poll")
    def force_poll():
        rest_app.log.debug("Executing Poll")
        tclock.poll();
        js = {
            'msg': 'Completed',
            'result': 'Success'
        }
        rest_app.log.debug("Poll completed, responding with: {}".format(js))
        return jsonify(js)
    @rest_app.route("/interval")
    def intervals():
        rest_app.log.debug("Gathering color change intervals")
        js = tclock.get_interval_ids()
        js['result'] = 'Success'
        rest_app.log.debug("Color change intervals gathered, responding with: {}".format(js))
        resp = rest_app.response_class(
            response=json.dumps(js,indent=4,default=jsonizer),
            status=200,
            mimetype='application/json'
        )
        return resp
    @rest_app.route("/interval/<color>")
    def interval(color):
        rest_app.log.debug("Gathering color change intervals for color: {}".format(color))
        js = {}
        js['intervals'] = tclock.get_interval_ids(color)
        js['result'] = 'Success'
        rest_app.log.debug("Color change intervals gathered for color: {}, responding with: {}".format(color,js))
        resp = rest_app.response_class(
            response=json.dumps(js,indent=4,default=jsonizer),
            status=200,
            mimetype='application/json'
        )
        return resp
    @rest_app.route("/interval/<color>",methods=["POST"])
    def create_interval(color):
        js = {
            'msg': '',
            'result': ''
        }
        status_code = 200
        interval_settings = { 'color': color }
        settings_reqd_keys = ['from_time','to_time','brightness']
        settings_opt_keys = ['brightness_changes']
        req_json = request.get_json()
        rest_app.log.debug("Preparing to create a new interval for color: {}, details: {}".format(color,req_json))
        for rk in settings_reqd_keys:
            try:
                interval_settings[rk] = req_json[rk]
            except KeyError:
                rest_app.log.warning("Request for new interval is missing a required key: {}".format(rk))
                js['msg'] = 'Missing required key "{}"'.format(rk)
                js['result'] = "Failed"
                resp = jsonify(js)
                resp.status_code = 400
                return resp
        for ok in settings_opt_keys:
            try:
                interval_settings[ok] = req_json[ok]
            except KeyError:
                pass
        try:
            rest_app.log.debug("Attempting to create a new interval with settings: {}".format(interval_settings))
            tclock.add_interval(**interval_settings)
            js['msg'] = "Created new interval"
            js['result'] = "Success"
            js['interval_id'] = len(tclock.timing[color]) - 1
            js['interval_settings'] = tclock.get_interval(color,js['interval_id'])
            js['interval_settings']['time_interval'] = jsonizer(js['interval_settings']['time_interval'])
            update_config()
        except:
            exc_type, exc_value, exc_traceback = sys.exc_info()
            js['msg'] = 'Failed: {}'.format(exc_value)
            js['result'] = 'Failed'
            rest_app.log.error("Error trying to create a new interval: {}".format(exc_value),exc_info=True)
            status_code = 400
        rest_app.log.debug("New interval processing done, responding with: {}".format(js))
        resp = jsonify(js)
        resp.status_code = status_code
        return resp
    @rest_app.route("/interval/<color>/<interval_id>",methods=["PUT"])
    def update_interval(color,interval_id):
        js = {
            'msg': '',
            'result': ''
        }
        status_code = 200
        changes = False
        interval_settings = {
            'color': color,
        }
        settings_opt_keys = ['from_time','to_time','brightness','brightness_changes']
        req_json = request.get_json()
        rest_app.log.debug("Preparing to update interval_id: {} for color: {} details: {}".format(interval_id,color,req_json))
        try:
            i_id = int(interval_id)
            interval_settings['interval_id'] = int(interval_id)
        except:
            rest_app.log.warning("Interval ID MUST be an integer: {}".format(interval_id))
            js['msg'] = 'Interval id must be an integer'
            js['result'] = 'Failed'
            resp = jsonify(js)
            resp.status_code = 400
            return resp
        for ok in settings_opt_keys:
            try:
                changes = True
                interval_settings[ok] = req_json[ok]
            except KeyError:
                pass
        try:
            rest_app.log.debug("Attempting to update interval_id: {} for color: {} with details: {}".format(interval_id,color,interval_settings))
            tclock.update_interval(**interval_settings)
            js['msg'] = "Updated interval: {}:{}".format(color,interval_id)
            js['result'] = "Success"
            js['new_interval_settings'] = tclock.get_interval(color,int(interval_id))
            js['new_interval_settings']['time_interval'] = jsonizer(js['new_interval_settings']['time_interval'])
            update_config()
        except:
            exc_type, exc_value, exc_traceback = sys.exc_info()
            js['msg'] = 'Failed: {}'.format(exc_value)
            js['result'] = 'Failed'
            rest_app.log.error("Error trying to update interval_id: {} for color: {}: {}".format(interval_id,color,exc_value),exc_info=True)
            status_code = 400
        rest_app.log.debug("Update interval processing done, responding with: {}".format(js))
        resp = jsonify(js)
        resp.status_code = status_code
        return resp
    @rest_app.route("/interval/<color>/<interval_id>",methods=["DELETE"])
    def delete_interval(color,interval_id):
        js = {
            'msg': '',
            'result': ''
        }
        status_code = 200
        rest_app.log.debug("Preparing to delete interval_id: {} for color: {}".format(interval_id,color))
        try:
            i_id = int(interval_id)
        except:
            js['msg'] = 'Interval id must be an integer'
            js['result'] = 'Failed'
            resp = jsonify(js)
            resp.status_code = 400
            return resp
        try:
            rest_app.log.debug("Attempting to delete interval_id: {} for color: {}".format(interval_id,color))
            tclock.del_interval(color,i_id)
            js['msg'] = 'Deleted interval'
            js['result'] = 'Success'
            update_config()
        except:
            exc_type, exc_value, exc_traceback = sys.exc_info()
            js['msg'] = 'Failed: {}'.format(exc_value)
            js['result'] = 'Failed'
            rest_app.log.error("Error trying to delete interval_id: {} for color: {}: {}".format(interval_id,color,exc_value),exc_info=True)
            status_code = 400
        rest_app.log.debug("Delete interval processing done, responding with: {}".format(js))
        resp = jsonify(js)
        resp.status_code = status_code
        return resp
    @rest_app.route("/light/<color>",methods=["PUT"])
    def set_light(color):
        js = {
            'msg': '',
            'result': ''
        }
        req_json = request.get_json()
        override_intervals = False
        rest_app.log.debug("Preparing to change light state for color: {} details: {}".format(color,req_json))
        try:
            state = req_json['state'].lower()
        except KeyError:
            rest_app.log.warning("Missing state 'key'")
            js['msg'] = 'Missing "state" key'
            js['result'] = "Failed"
            resp = jsonify(js)
            resp.status_code = 400
            return resp
        if state not in ['on','off']:
            rest_app.log.warning("State must be either 'on' or 'off': {}".format(state))
            js['msg'] = 'Invalid state: {}, must be one of :"on" or "off"'.format(state)
            js['result'] = 'Failed'
            resp = jsonify(js)
            resp.status_code = 400
            return resp
        try:
            override_intervals = req_json['override_intervals']
        except KeyError:
            pass
        if state == 'on':
            try:
                brightness = int(req_json['brightness'])
            except KeyError:
                brightness = 255
                pass
            rest_app.log.debug("Attempting to change light state for color 'on': {}".format(color))
            tclock.turn_on(color,brightness,override_intervals)
            js['msg'] = 'Turned color: {} ON'.format(color)
        if state == 'off':
            rest_app.log.debug("Attempting to change light state for color 'off': {}".format(color))
            tclock.turn_off(color,override_intervals)
            js['msg'] = 'Turned color: {} OFF'.format(color)
        js['result'] = 'Success'
        rest_app.log.debug("Change light state processing done, responding with: {}".format(js))
        resp = jsonify(js)
        return resp
    return rest_app

def init_websocket_api():
    res_map = OrderedDict({
        '/+websocket': WebsocketApi,
    })
    if WSGI_APP:
        res_map['^(?!/+websocket)'] = WSGI_APP
    resource = Resource(res_map)
    cm = ChannelMgr()
    cm.add_channel("status_changes")
    return (resource,cm)

##-Main-##
#Change into the directory where this script was run from:
MY_LOCATION = os.path.dirname(os.path.realpath(__file__))
if os.path.isdir('{}/static'.format(MY_LOCATION)):
    os.chdir(os.path.dirname(os.path.realpath(__file__)))
elif os.path.isdir('/var/lib/toddleglow/static'):
    os.chdir('/var/lib/toddleglow')

#Load our config file
if len(sys.argv) > 1:
    CONFIG_PATH=sys.argv[1]

if CONFIG_PATH:
    REAL_CONFIG_PATH=CONFIG_PATH
else:
    REAL_CONFIG_PATH=DEFAULT_CONFIG_PATH

if not os.path.exists(REAL_CONFIG_PATH):
    CONFIG_FILE = open(REAL_CONFIG_PATH,'w')
    CONFIG_FILE.close()
    new_config = True
else:
    new_config = False

try:
    CONFIG_FILE = open(REAL_CONFIG_PATH,'r+')
    if not new_config:
        CONFIG = json.load(CONFIG_FILE)
        for k in DEFAULT_OPTS:
            try:
                t = CONFIG[k]
                del(t)
            except KeyError:
                CONFIG[k] = DEFAULT_OPTS[k]
    else:
        CONFIG = dict(DEFAULT_OPTS)
except:
    print("Error reading in config file at: {}".format(REAL_CONFIG_PATH))
    raise

#Initialize logger
try:
    LOG_LEVEL = int(CONFIG['log_level'])
except ValueError:
    try:
        LOG_LEVEL = LOGGING_LEVELS[CONFIG['log_level'].lower()]
    except:
        raise
logging.basicConfig(
    level=LOG_LEVEL,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger("Main")

#Initialize signal handlers
gevent.signal(signal.SIGINT,sig_shutdown)
gevent.signal(signal.SIGQUIT,sig_shutdown)

#Check if piglow settings are ok
if not PIGLOW_ENABLED and CONFIG['piglow_enabled']:
    logger.error("Piglow module is NOT installed, but configuration wants to enable it.")
    sys.exit(1)

#Start APIs
logger.info("Initializing APIs")
if CONFIG['api_rest']:
    logger.debug("Initializing REST API")
    WSGI_APP=init_rest_api()
    logger.debug("REST API Initialized")
    APP=WSGI_APP
    logger.debug("Static folder set to be at: {}".format(APP.static_folder))
if CONFIG['api_websocket']:
    logger.debug("Initializing WebSocket API")
    APPS_RESOURCE = init_websocket_api()
    logger.debug("WebSocket API Initialized")

logger.info("Starting APIs")
if APPS_RESOURCE or WSGI_APP:
    if WSGI_APP:
        APP = WSGI_APP
    if APPS_RESOURCE:
        APP = APPS_RESOURCE[0]
        CHANNELMSGR = APPS_RESOURCE[1]
        SERVER_FUNC = WebSocketServer
    #Create a WSGI server
    logger.debug("Starting WSGI Server using: {}, listening on: {}:{}".format(
            SERVER_FUNC.__name__,
            CONFIG['api_listen'],
            CONFIG['api_port']
        )
    )
    wsgi = SERVER_FUNC(
        listener=(CONFIG['api_listen'], CONFIG['api_port']),
        application=APP
    )
    #Start the WSGI server
    wsgi.start()

#Initialize our clock
logger.info("Initializing ToddlerClock with timezone: {}".format(CONFIG['time_zone']))
tclock = ToddlerClock(time_zone=CONFIG['time_zone'],channel_com=CHANNELMSGR,piglow_enabled=CONFIG['piglow_enabled'])

#Load any intervals from the config file into our clock
logger.info("Importing any configured intervals into the ToddlerClock")
for c in CONFIG['intervals']:
    for i in CONFIG['intervals'][c]:
        logger.debug("Found Interval for color: {} for: {}".format(c,i['time_interval']))
        from_time, to_time = i['time_interval'].replace(' => ',',').split(',')
        tclock.add_interval(c,from_time,to_time,i['brightness'],i['brightness_change_at'])

#Update our config obj and save to file
update_config()

#Event Loop
logger.info("Finished startup, Running...")
while RUNNING:
    #logger.debug("Polling ToddlerClock for needed state changes")
    tclock.poll()
    gevent.wait(timeout=1)

#Close down gevent servers
logger.info("Shutting down..")
wsgi.close()
wsgi.stop(timeout=1)
