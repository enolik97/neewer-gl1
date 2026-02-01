// import dgram from 'dgram'
// dgram with promises
var PORT, buildHandshake, command_delay, command_queue, guessIp, hexify, normalizeMac, options, parse_and_execute, presets, resolveMacToIp, send;

import {
  DgramAsPromised
} from "dgram-as-promised";

import Sugar from 'sugar-and-spice';

Sugar.extend();

import chalk from "chalk";

import program from 'commander';

import os from 'os';

import {
  execSync
} from 'child_process';

PORT = 5052;

presets = {
  "on": "800502010189",
  "off": "800502010088"
};

program.version("Neewer GL1 Key Light Control 2.0").option("-h, --host [char]").option("-m, --mac [char]", "light MAC address (e.g. 08:F9:E0:62:5B:FB); resolves IP from ARP so IP changes are OK").option("-H, --hex [char]").option("-I, --client_ip [char]").option("-p, --power [off/on]").option("-b, --brightness [int]").option("-t, --temperature [int]").option("-d, --delay [int]").parse(process.argv);

// Default command prints out a list of ports
program.parse();

options = program.opts();

command_queue = [];

command_delay = 50;

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

send = async function(host, port) {
  var bytes, client, hexCommand, message;
  if (command_queue.length === 0) {
    console.log("Command queue is empty! Done.");
    return;
  }
  client = DgramAsPromised.createSocket('udp4');
  await client.bind(port, '0.0.0.0');

  const rawSocket = client.socket;
  const waitFor8003Reply = () =>
    new Promise((resolve) => {
      const onMessage = (msg) => {
        if (msg.length >= 2 && msg[0] === 0x80 && msg[1] === 0x03) {
          rawSocket.off("message", onMessage);
          resolve();
        }
      };
      rawSocket.on("message", onMessage);
    });

  try {
    // Send handshake packets (first 3 in queue) with 50ms between each
    for (var i = 0; i < 3 && command_queue.length > 0; i++) {
      hexCommand = command_queue.shift();
      message = Buffer.from(hexCommand, "hex");
      await client.send(message, 0, message.length, port, host);
      console.log(`Sent handshake [${hexCommand}] to ${host}:${port}`);
      if (i < 2) await delay(command_delay);
    }

    // Wait for light's 80:03 reply before sending power/other commands
    await waitFor8003Reply();
    console.log("Received 80:03 reply from light.");

    // Send remaining commands (power, brightness/temp, etc.) on same socket
    while (command_queue.length > 0) {
      hexCommand = command_queue.shift();
      message = Buffer.from(hexCommand, "hex");
      bytes = await client.send(message, 0, message.length, port, host);
      console.log(`Sent message [${hexCommand}] (${bytes} bytes) to ${host}:${port}`);
      await delay(command_delay);
    }
  } finally {
    await client.close();
    console.log("Connection closed. Done.");
  }
};

// Same handshake as index.mjs: 80 02 12 00 00 0f [IP 15 chars as hex] [checksum = sum of all bytes & 0xff]
buildHandshake = function(ip) {
  var all, checksum, header, headerHex, ipBytes, ipHex, sum;
  header = [0x80, 0x02, 0x12, 0x00, 0x00, 0x0f];
  ipBytes = Array.from(ip).map(function(c) {
    return c.charCodeAt(0);
  });
  all = header.concat(ipBytes);
  sum = all.reduce(function(a, b) {
    return a + b;
  }, 0);
  checksum = (sum & 0xff).toString(16).padStart(2, "0");
  headerHex = header.map(function(b) {
    return b.toString(16).padStart(2, "0");
  }).join("");
  ipHex = Array.from(ip).map(function(c) {
    return c.charCodeAt(0).toString(16);
  }).join("");
  return `${headerHex}${ipHex}${checksum}`;
};

guessIp = function() {
  var addresses, nics, ref;
  nics = os.networkInterfaces();
  addresses = [];
  Object.keys(nics).forEach(function(key) {
    return addresses.push(nics[key]);
  });
  addresses = addresses.flatten().filter(function(addr) {
    return addr.family === "IPv4" && addr.address !== "127.0.0.1";
  });
  return (ref = addresses.first()) != null ? ref.address : void 0;
};

normalizeMac = function(mac) {
  var hex = mac.toLowerCase().replace(/[^a-f0-9]/g, '');
  return hex.padStart(12, '0');
};

resolveMacToIp = function(mac) {
  var i, ip, len, line, lineMac, match, normalized, output, ref;
  normalized = normalizeMac(mac);
  try {
    output = execSync('arp -a', {
      encoding: 'utf8'
    });
  } catch (error) {
    return null;
  }
  ref = output.split('\n');
  for (i = 0, len = ref.length; i < len; i++) {
    line = ref[i];
    // macOS: ? (192.168.178.88) at 08:F9:E0:62:5B:FB	 on en0
    match = line.match(/\((\d+\.\d+\.\d+\.\d+)\)\s+at\s+([0-9a-fA-F:.-]+)/);
    if (match) {
      ip = match[1];
      lineMac = normalizeMac(match[2]);
      if (lineMac === normalized) {
        return ip;
      }
    }
  }
  return null;
};

hexify = function(brightness, temperature) {
  var hex, setting;
  setting = [128, 5, 3, 2];
  setting.append([parseInt(brightness), parseInt(temperature)]);
  setting.append(setting.sum());
  hex = setting.map(function(o) {
    return o.toString(16).padLeft(2, "0");
  });
  return hex.join("");
};

parse_and_execute = async function(options) {
  var host, initCommand, ipAddress;
  host = options.mac ? resolveMacToIp(options.mac) : options.host;
  if (options.mac && !host) {
    console.log(chalk.red(`MAC ${options.mac} not found in ARP table. Use the Neewer app or ping the light once so it appears.`));
    return;
  }
  if (!host) {
    console.log(chalk.red("Provide -h/--host (light IP) or -m/--mac (light MAC) to run."));
    return;
  }
  if (host != null) {
    if (options.mac != null) {
      console.log(chalk.green(`Resolved ${options.mac} -> ${host}`));
    }
    if (options.client_ip != null) {
      ipAddress = options.client_ip;
      console.log(chalk.green(`Using ${ipAddress} as the local IP address`));
    } else {
      ipAddress = guessIp();
      if (!ipAddress) {
        console.log(chalk.red("Could not determine your computer's IP (no non-loopback IPv4). Use -I to set it (e.g. -I 192.168.178.165)."));
        return;
      }
      console.log(chalk.yellow(`client_ip not provided, using ${ipAddress} as the local IP address`));
    }
    if (options.delay != null) {
      command_delay = options.delay;
    }
    console.log(`Command delay set to ${command_delay}ms`);
    initCommand = buildHandshake(ipAddress);
    command_queue.append([initCommand, initCommand, initCommand]);
    console.log(`${chalk.yellow("Light Host:")} ${host}:${PORT}`);
    if (options.hex != null) {
      console.log(`${chalk.red("Hex Override:")} ${options.hex}`);
      // send options.host, PORT, options.hex
      command_queue.append(options.hex);
    } else {
      if (options.power != null) {
        switch (options.power.toLowerCase()) {
          case "off":
            console.log(`Set light to ${chalk.red("OFF")} state. Brightness and/or temperature parameters will be sent but have no effect.`);
            command_queue.append(presets.off);
            break;
          case "on":
            console.log(`Set light to ${chalk.green("ON")} state`);
            command_queue.append(presets.on);
            break;
          default:
            console.log(chalk.red(`Invalid power state '${options.power.toLowerCase()}'. Valid states are 'on' and 'off' only.`));
        }
      }
      if ((options.brightness != null) || (options.temperature != null)) {
        if ((options.brightness != null) && (options.temperature != null)) {
          console.log(chalk.yellow(`Set brightness to ${options.brightness}% and temperature to ${options.temperature}00K`));
          command_queue.append(hexify(options.brightness, options.temperature));
        } else {
          console.log(chalk.red("When setting brightness or temperature, BOTH parameters are required."));
          return;
        }
      }
    }
    return (await send(host, PORT));
  }
};

parse_and_execute(options);
