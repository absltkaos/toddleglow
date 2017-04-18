# toddleglow
Raspberry Pi PiGlow based Toddler Clock.

With this you can set specific intervals and brightnesses for various colors to turn on and when to turn them off. So you can do things like...having the Orange lights turn from 8pm -> 7:30am, then at 7:30am turn green.

This kind of functionality has been a life saver for parents that have kids who are early risers... "If the clock is Orange, you should go back to sleep. When it turns green then it is morning and you can come out of you room". It takes some training for your child, but will hopefully save your own sanity.

# Setup 
The setup is simple, follow the instructions for getting the PiGlow working. Specifically:

 1. Install Raspbian
 1. Enable i2c-dev module: `echo "i2c-dev" >> /etc/modules ; modprobe i2c-dev`
    1. [NOTE] You can also do this through `raspi-config => Interfacing Options => P5 I2C`
 1. Install python dependencies: `apt-get install python-flask python-gevent-websocket python-gevent python-arrow python-piglow`
 1. Place the files from the project in a directory and run: `./toddleglow.py`

Browse to the web UI: http://[ip of Pi]:8080

The initial run will create a `config.json` file. You can edit it to suit your needs if you need to change listening address/port etc...

[NOTE] Make sure you stop the application (Currently just, CTRL+C) before editing config.json.
