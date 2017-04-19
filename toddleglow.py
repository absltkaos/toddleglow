#!/usr/bin/python
import piglow
import arrow
import gevent.wsgi
import json
import sys
import os
from flask import Flask, request, jsonify
from geventwebsocket import WebSocketServer, WebSocketApplication, Resource

DEFAULT_CONFIG_PATH = "./config.json"
CONFIG_PATH = ""
REAL_CONFIG_PATH = DEFAULT_CONFIG_PATH
default_opts = {
    'api_listen': '0.0.0.0',
    'api_port': 8080,
    'api_debug_mode': False,
    'intervals': {},
    'api_rest': True,
    'api_websocket': True
}
server_func = gevent.wsgi.WSGIServer
config_file = None # This holds our config file object
config = {} # this holds our config dict
wsgi_app = None #This holds our Flask app
apps_resource = None
app = None
running = True
channelmsgr = None

##-Classes-##
class ToddlerClock:
    def __init__(self):
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
        cur_datetime = arrow.utcnow().to('US/Mountain')
        cur_time = cur_datetime.strftime("%H:%M")
        #print("{}: Checking light timing status".format(cur_datetime))
        for color in self.state:
            if self.state[color]['override_intervals']:
                continue
            ai = self._active_interval(color)
            if ai != None:
                #There is an active interval, act according to interval settings
                i = self.timing[color][ai]
                if not self.state[color]['on']:
                    print("Turning color: {} on".format(color))
                    self.turn_on(color,i['brightness'])
                else:
                    if self.state[color]['brightness'] != i['brightness']:
                        self.turn_on(color,i['brightness'])
                #Adjust brightness if there are changes
                if self.state[color]['on']:
                    bkeys = sorted(list(i['brightness_change_at']),key=self._human_keys)
                    bkeys.reverse()
                    for bt in bkeys:
                        ti = TimeInterval(bt,i['time_interval'].to_time)
                        if ti.now_in_interval():
                            del(ti)
                            b = i['brightness_change_at'][bt]
                            if self.state[color]['brightness'] != i['brightness_change_at'][bt]:
                                print("Adjusting brightness of color: {} to {}".format(color,b))
                                self.turn_on(color,b)
                            break
            else:
                #No active intervals, so turn off color if 'on'
                if self.state[color]['on']:
                    print("Turning color: {} off".format(color))
                    self.turn_off(color)
    def turn_on(self,color,brightness=255,override_intervals=None):
        try:
            self.state[color]['on'] = True
            self.state[color]['brightness'] = brightness
            piglow.colour(color,int(brightness))
            if override_intervals == True:
                self.state[color]['override_intervals'] = True
            if override_intervals == False:
                self.state[color]['override_intervals'] = False
        except KeyError:
            raise ValueError("ERROR: unknown color: {}".format(color))
    def turn_off(self,color,override_intervals=None):
        try:
            if self.state[color]['on']:
                piglow.colour(color,0)
                self.state[color]['on'] = False
                self.state[color]['brightness'] = 0
            if override_intervals == True:
                self.state[color]['override_intervals'] = True
            if override_intervals == False:
                self.state[color]['override_intervals'] = False
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
    def __init__(self,name,members=None):
        self.name = name
        if members:
            self.members = members
        else:
            self.members = []
    def broadcast(self,msg):
        for m in self.members:
            try:
                m.ws.send(msg)
            except:
                raise
    def subscribe(self,member):
        self.members.append(member)
    def unsubscribe(self,member):
        self.members.remove(member)

class ChannelMgr():
    def __init__(self):
        self.channels = {}
    def add_channel(self,name,members=None):
        self.channels[name] = Channel(name,members)
    def broadcast(self,msg):
        for c in self.channels:
            self.channels[c].broadcast(msg)
    def broadcast_to(self,channel,msg):
        self.channels[channel].broadcast(msg)
    def subscribe(self,channel,member):
        self.channels[channel].subscribe(member)
    def unsubscribe(self,channel,member):
        self.channels[channel].unsubscribe(member)

class WebsocketApi(WebSocketApplication):
    def __init__(self, ws):
        self.protocol = self.protocol_class(self)
        self.ws = ws
        channelmsgr.subscribe("status_change",self)
    def on_open(self):
        print "Connection opened"
    def on_message(self, message):
        self.ws.send(message)
    def on_close(self, reason):
        channelmsgr.unsubscribe("status_change",self)
        print reason

##-Helper functions-##

def jsonizer(obj):
    try:
        return obj._toJSON()
    except:
        return obj.__repr__()

def update_config():
    config['intervals'] = tclock.timing
    config_file.seek(0)
    config_file.truncate()
    config_file.write(json.dumps(config,indent=4,default=jsonizer))
    config_file.flush()

def init_rest_api():
    #Initialize Flask based API
    rest_app=Flask(__name__)
    #Set Flask debug if needed
    if config['api_debug_mode']:
        rest_app.debug = True
    @rest_app.route("/")
    def root():
        return rest_app.send_static_file('index.html')

    @rest_app.route("/status")
    def status():
        js = {}
        get_state = request.args.get('state', 't').lower()
        get_intervals = request.args.get('intervals', 't').lower()
        get_color = request.args.get('color','').lower()
        
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
        resp = rest_app.response_class(
            response=json.dumps(js,indent=4,default=jsonizer),
            status=200,
            mimetype='application/json'
        )
        return resp

    @rest_app.route("/poll")
    def force_poll():
        tclock.poll();
        js = {
            'msg': 'Completed',
            'result': 'Success'
        }
        return jsonify(js)

    @rest_app.route("/interval")
    def intervals():
        js = tclock.get_interval_ids()
        resp = rest_app.response_class(
            response=json.dumps(js,indent=4,default=jsonizer),
            status=200,
            mimetype='application/json'
        )
        return resp

    @rest_app.route("/interval/<color>")
    def interval(color):
        js = tclock.get_interval_ids(color)
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
        for rk in settings_reqd_keys:
            try:
                interval_settings[rk] = req_json[rk]
            except KeyError:
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
            status_code = 400
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
        try:
            i_id = int(interval_id)
            interval_settings['interval_id'] = int(interval_id)
        except:
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
            status_code = 400
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
        try:
            i_id = int(interval_id)
        except:
            js['msg'] = 'Interval id must be an integer'
            js['result'] = 'Failed'
            resp = jsonify(js)
            resp.status_code = 400
            return resp
        try:
            tclock.del_interval(color,i_id)
            js['msg'] = 'Deleted interval'
            js['result'] = 'Success'
            update_config()
        except:
            exc_type, exc_value, exc_traceback = sys.exc_info()
            js['msg'] = 'Failed: {}'.format(exc_value)
            js['result'] = 'Failed'
            status_code = 400
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
        try:
            state = req_json['state'].lower()
        except KeyError:
            js['msg'] = 'Missing "state" key'
            js['result'] = "Failed"
            resp = jsonify(js)
            resp.status_code = 400
            return resp
        if state not in ['on','off']:
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
            tclock.turn_on(color,brightness,override_intervals)
            js['msg'] = 'Turned color: {} ON'.format(color)
        if state == 'off':
            tclock.turn_off(color,override_intervals)
            js['msg'] = 'Turned color: {} OFF'.format(color)
        js['result'] = 'Success'
        resp = jsonify(js)
        return resp
    return rest_app

def init_websocket_api():
    res_map = {
        '/websocket': WebsocketApi,
    }
    if wsgi_app:
        res_map['^(?!/websocket)'] = wsgi_app
    resource = Resource(res_map)
    cm = ChannelMgr()
    cm.add_channel("status_change")
    return (resource,cm)

##-Main-##
#Change into the directory where this script was run from:
os.chdir(os.path.dirname(os.path.realpath(__file__)))

#Load our config file
if len(sys.argv) > 1:
    CONFIG_PATH=sys.argv[1]

if CONFIG_PATH:
    REAL_CONFIG_PATH=CONFIG_PATH
else:
    REAL_CONFIG_PATH=DEFAULT_CONFIG_PATH

if not os.path.exists(REAL_CONFIG_PATH):
    config_file = open(REAL_CONFIG_PATH,'w')
    config_file.close()
    new_config = True
else:
    new_config = False

try:
    config_file = open(REAL_CONFIG_PATH,'r+')
    if not new_config:
        config = json.load(config_file)
    else:
        config = dict(default_opts)
except:
    print("Error reading in config file at: {}".format(REAL_CONFIG_PATH))
    raise

#Start APIs
if config['api_rest']:
    wsgi_app=init_rest_api()
    app=wsgi_app
if config['api_websocket']:
    apps_resource = init_websocket_api()

if apps_resource or wsgi_app:
    if wsgi_app:
        app = wsgi_app
    if apps_resource:
        app = apps_resource[0]
        channelmsgr = apps_resource[1]
        server_func = WebSocketServer
    #Create a WSGI server
    wsgi = server_func(
        listener=(config['api_listen'], config['api_port']),
        application=app
    )
    #Start the WSGI server
    wsgi.start()

#Initialize our clock
tclock = ToddlerClock()

#Load any intervals from the config file into our clock
for c in config['intervals']:
    for i in config['intervals'][c]:
        from_time, to_time = i['time_interval'].replace(' => ',',').split(',')
        tclock.add_interval(c,from_time,to_time,i['brightness'],i['brightness_change_at'])

#Update our config obj and save to file
update_config()

#Event Loop
print("Running...")
while running:
    tclock.poll()
    gevent.wait(timeout=10)

#Close down gevent servers
print("Shutting down...")
wsgi.close()
wsgi.stop(timeout=1)
