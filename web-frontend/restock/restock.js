import { ReconnectingSocket } from "/shared/reconnecting-socket.js";

let socket = await (async () => {
  // Allow URL parameters to configure the location of the relay server.
  // Default to ws://localhost:8080/
  const params = new URLSearchParams(window.location.search);
  const host = params.get("relay_host") ?? "localhost";
  const port = params.get("relay_port") ?? "8080";

  // We claim to be POS so that we receive scan events
  return await ReconnectingSocket.connect(`ws://${host}:${port}/`, "pos");
})();

let buffer = "";

// Since we're just listening for any keypress, we'll want to clear spurious keypresses.
// We'll say that all barcode scanners should emit their letters less than 1 second apart
// This is super generous. If a fully barcode has not been read after 1 second, start over.
let timeout;
document.onkeydown = ({key}) => {
  // Only accept input if no input element is selected
  if (window.activeElement === undefined && key.match(/^[0-9]$/)){
    clearTimeout(timeout);
    buffer += key
    if (buffer.length === 12) {
      scan(buffer);
      buffer = "";
    } else {
      timeout = setTimeout(() => buffer = '', 1000);
    }
  }
};

async function scan(upc) {
  report("");

  try {
    let info = await socket.request({
      header: {
        to: "inventory",
        type: "info_req",
      },
      body: {
        barcode: upc,
      },
    });
    switch (info.header.type) {
      case "item_info":
        render(info.body);
        break;

      case "user_info":
        report("Scanned user id");
        break;
    }
  } catch (e) {
    render({ barcode: upc});
  }
};

function render(obj) {
  let html = `
            <fieldset name="fields" id="fields" oninput="display_cost()">
            <input type="hidden" name="id" value="${obj?.id ?? ""}"/>
            <br />
            <label for="barcode">Barcode: </label> 
            <input disabled type="text" name="barcode" value="${
              obj?.barcode ?? ""
            }"/> ${obj.cents !== undefined ? `Current Cost: ${dollars(obj.cents)}`: ''}
            <br />
            <label for="name">Name: </label> 
            <input required minlength=1 title="Cannot be empty" type="text" name="name" value="${
              obj?.name ?? ""
            }"/>
            <br />
            <label for="bulk_cost">Bulk Count: </label> 
            <input required type="number" name="bulk_count" value=""/>
            <br />
            <label for="bulk_cost">Bulk Cost: </label> 
            <input required type="text" pattern="\\d+\.\\d\\d" name="bulk_cost" value=""/>
            <br />
            <label for="bulk_cost">Tax?: </label> 
            <input type="checkbox" name="tax" />
            <br />

            <div>Calculated Cost: <span id="cost"></span></div>

            <button id="submit" type="submit">${
              obj?.id === undefined ? "Create" : "Update"
            }</button>
            </fieldset>
    `;

  document.getElementById("form").innerHTML = html;
  document.getElementById("fields").disabled = false;
}

function form_values() {
  let values = {};
  document.querySelectorAll("#fields > input").forEach((el) => {
    if (el.type === "checkbox") {
      values[el.name] = el.checked;
    } else {
      values[el.name] = el.value;
    }
  });
  return values;

}

function calculate_cost_in_cents() {
  const form = form_values();
  const bulk_cost = Number.parseFloat(form.bulk_cost);
  const tax_cost = form.tax ? bulk_cost * 1.077 : bulk_cost;
  const overhead_cost = tax_cost * 1.2;
  const unit_price = overhead_cost / Number.parseInt(form.bulk_count);
  return Math.ceil(unit_price * 100);
}

window.display_cost = () => {
  document.getElementById('cost').innerHTML = "$" + dollars(calculate_cost_in_cents());
};

function dollars(cents) {
  let d = Math.floor(cents / 100);
  let c = Math.abs(cents) % 100;
  return `${d}.${c < 10 ? "0" + c : c}`;
}

async function submit(ev) {
  ev.preventDefault();
  document.getElementById("fields").disabled = true;

  let form = form_values();

  try {
    await socket.request({
      header: {
        to: "inventory",
        type: "update_info",
      },
      body: {
        id: form["id"] === "" ? null : form["id"],
        name: form["name"],
        cents: calculate_cost_in_cents(),
        barcode: form["barcode"],
      },
    });
    report("Success!");
  } catch (e) {
    console.log(e);
    report(e);
  }
}

function report(msg) {
  document.getElementById("error").innerHTML = msg;
}

document.getElementById("form").addEventListener("submit", submit);
