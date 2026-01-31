# import dgram from 'dgram'
# dgram with promises
import {DgramAsPromised} from "dgram-as-promised" 
import Sugar from 'sugar-and-spice'
Sugar.extend()
import chalk from "chalk"

import program from 'commander'
import os from 'os'
import { execSync } from 'child_process'

PORT = 5052


presets = 
  "on": "800502010189"
  "off": "800502010088"

program
.version("Neewer GL1 Key Light Control 2.0")
.option("-h, --host [char]")
.option("-m, --mac [char]", "light MAC address (e.g. 08:F9:E0:62:5B:FB	); resolves IP from ARP so IP changes are OK")
.option("-H, --hex [char]")
.option("-I, --client_ip [char]")
.option("-p, --power [off/on]")
.option("-b, --brightness [int]")
.option("-t, --temperature [int]")
.option("-d, --delay [int]")


.parse(process.argv)

# Default command prints out a list of ports
program.parse()

options = program.opts()

command_queue = []

command_delay = 500

send = (host, port)->
  
  client = DgramAsPromised.createSocket('udp4')
  
  if command_queue.length > 0  
    hexCommand = command_queue.shift()
    message = new Buffer.from(hexCommand,"hex")
    
    bytes = await client.send message, 0, message.length, port, host #, (err, bytes) ->
    console.log chalk.blue("Sent command [#{hexCommand}] (#{bytes} bytes) to #{host}:#{port}")
      #
    closed = await client.close()
    # console.log "Connection closed. Going to next in queue."
    # prevent commands from being issued too quickly
    send.delay command_delay, host,port 
  else
    console.log chalk.green("Command queue is empty! Done.")
    
convertIp = (ip)->
  segments = ip.split(".")
  ascii = segments.map
  hexified = Array.from(ip).map (char,index)->
    return char.charCodeAt(0).toString(16)
  return hexified.join("")

guessIp = ()->
  nics = os.networkInterfaces()
  addresses = []
  Object.keys(nics).forEach (key)->
    addresses.push nics[key]
  addresses =  addresses.flatten().filter( {family: "IPv4"} )
  return addresses.first().address

normalizeMac = (mac)->
  hex = mac.toLowerCase().replace(/[^a-f0-9]/g, '')
  hex.padStart(12, '0')

resolveMacToIp = (mac)->
  normalized = normalizeMac(mac)
  try
    output = execSync('arp -a', { encoding: 'utf8' })
  catch
    return null
  for line in output.split('\n')
    # macOS: ? (192.168.178.88) at 08:F9:E0:62:5B:FB	 on en0
    match = line.match(/\((\d+\.\d+\.\d+\.\d+)\)\s+at\s+([0-9a-fA-F:.-]+)/)
    if match
      ip = match[1]
      lineMac = normalizeMac(match[2])
      return ip if lineMac is normalized
  null

hexify = (brightness, temperature)->
  setting = [128,5,3,2]
  setting.append [parseInt(brightness),parseInt(temperature)]
  setting.append setting.sum()
  hex = setting.map (o)->
    return o.toString(16).padLeft(2,"0")
  return hex.join("")

parse_and_execute = (options)->
  host = if options.mac then resolveMacToIp(options.mac) else options.host
  if options.mac and not host
    console.log chalk.red("MAC #{options.mac} not found in ARP table. Use the Neewer app or ping the light once so it appears.")
    return
  if not host
    console.log chalk.red("Provide -h/--host (light IP) or -m/--mac (light MAC) to run.")
    return
  if host?
    if options.mac?
      console.log chalk.green("Resolved #{options.mac} -> #{host}")
    if options.client_ip?
      ipAddress = options.client_ip
      console.log chalk.green("Using #{ipAddress} as the local IP address")
    else
      ipAddress = guessIp()
      console.log chalk.yellow("client_ip not provided, using #{ipAddress} as the local IP address")
    
    if options.delay?
      command_delay = options.delay
    console.log "Command delay set to #{command_delay}ms"

    #init command
    initCommand = "80021000000d#{convertIp(ipAddress)}2e"
    # console.log initCommand 
    command_queue.append [ initCommand, initCommand, initCommand ]
    

    console.log "#{chalk.yellow("Light Host:")} #{host}:#{PORT}"
    if options.hex?
      console.log "#{chalk.red("Hex Override:")} #{options.hex}"
      # send options.host, PORT, options.hex
      command_queue.append options.hex
    else
      if options.power?
        switch options.power.toLowerCase()
          when "off"
            console.log "Set light to #{chalk.red("OFF")} state. Brightness and/or temperature parameters will be sent but have no effect."
            command_queue.append presets.off

          when "on"
            console.log "Set light to #{chalk.green("ON")} state"
            command_queue.append presets.on
          else
            console.log chalk.red("Invalid power state '#{options.power.toLowerCase()}'. Valid states are 'on' and 'off' only.")
      
      if options.brightness? or options.temperature?
        brightness = options.brightness ? 100
        temperature = options.temperature ? 50
        console.log chalk.yellow("Brightness not set, using default #{brightness}%") if not options.brightness?
        console.log chalk.yellow("Temperature not set, using default #{temperature}00K") if not options.temperature?
        console.log chalk.yellow("Set brightness to #{brightness}% and temperature to #{temperature}00K")
        command_queue.append hexify(brightness, temperature)
    await send host, PORT

parse_and_execute(options)
