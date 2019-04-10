# toddleglow
Raspberry Pi PiGlow, or screen based Toddler Clock.

## What is a Toddler Clock??
A Toddler Clock is a device that will change colors based on user specified time intervals.

## Purpose
A Toddler Clock can be used in combination with Rasbpian and a PiGlow (made by pimoroni, https://shop.pimoroni.com/products/piglow). Alternatively you could use a screen/monitor from a laptop or old cellphone

You can then set specific intervals and brightnesses for various colors to turn on and when to turn them off. This allows you to do things like...having the Orange lights turn turn on from 8pm -> 7:30am, then at 7:30am turn green.

This kind of functionality has been a life saver for parents that have kids who are early risers... "If the clock is Orange, you should go back to sleep. When it turns green then it is morning and you can come out of you room". It takes some training for your child, but
will hopefully save your own sanity. It also helps then to know when it is morning without loud, jarring alarms, as well as builds self-confidence in getting up on their own without making mom and dad cranky.

# Setup
The setup is simple, follow the instructions for getting the PiGlow working. Specifically:

1. Install Raspbian, or other Debian based Linux distribution.
1. Decide if you're going to do a PiGlow based, or screen based setup
   1. PiGlow based
      1. Enable i2c-dev module: `echo "i2c-dev" >> /etc/modules ; modprobe i2c-dev`
         * *[NOTE]* You can also do this through `raspi-config => Interfacing Options => P5 I2C`
   1. Screen based. No custom steps, other than you need a device with a webbrowser that supports javascript
1. Install debian package: `sudo apt install <path to toddleglow deb>`
1. Enable the service to start on boot: `sudo systemctl enable toddleglow.service`
1. Start the service: `sudo systemctl start toddleglow.service`
  
Browse to the web UI: http://[ip of Pi]:8080

The initial start up of the service will create a `config.json` file. You can edit it to suit your needs if you need to change listening address/port etc...

*[NOTE]* Make sure you stop the application (Currently just, CTRL+C) before editing config.json.
# Screenshots
## Desktop browser view
### Main view of webui with a color that has an interval all set
![Desktop Main](/img/desktop_with_interval.png)

### Creating a new interval for when a color should be turned on.
![Making Interval](/img/desktop_new_interval_time_select.png)

### New interval all filled out.
![Interval Filled Out](/img/desktop_new_interval_filledout.png)

## Mobile browser view
### Main view
![Mobile Main](/img/mobile_main.png)

### Viewing interval details
![Mobile Interval Details](/img/mobile_interval_details_view.png)

### New Screen mode (using the mobile phone's browser as the light source)
![Mobile Screen Mode](/img/mobile_screen_mode.png)
