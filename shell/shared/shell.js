Apps = new Meteor.Collection("apps");
UserActions = new Meteor.Collection("userActions");
Grains = new Meteor.Collection("grains");

Meteor.methods({
  ensureInstalled: function (appid, url) {
    var app = Apps.findOne({ appid: appid });
    if (app) {
      if (app.status === "ready" || app.status === "failed") {
        // Don't try to install.
        return;
      }
    } else {
      Apps.insert({ appid: appid, status: "download", progress: 0 });
    }

    // Start installing on the server side if we aren't already.
    if (!this.isSimulation) {
      startInstall(appid, url);
    }
  }
});

if (Meteor.isServer) {
  var Fs = Npm.require("fs");
  var Path = Npm.require("path");
  var GRAINDIR = "/var/sandstorm/grains";

  Meteor.methods({
    cancelDownload: function (appid) {
      cancelDownload(appid);
    },

    newGrain: function (appid, command) { newGrain(appid, command); }
  });
}

if (Meteor.isClient) {
  var activeAppId;
  var appDatabaseId;

  Template.grainList.events({
    "click #apps-ico": function (event) {
      var ico = event.currentTarget;
      var pop = document.getElementById("apps");
      if (pop.style.display == "block") {
        pop.style.display = "none";
      } else {
        var rec = ico.getBoundingClientRect();
        pop.style.left = rec.left + "px";
        pop.style.top = rec.bottom + 16 + "px";
        pop.style.display = "block";

        var left = rec.left - Math.floor((pop.clientWidth - rec.width) / 2);
        if (left < 8) {
          left = 8;
        } else if (left + pop.clientWidth > window.innerWidth) {
          left = window.innerWidth - pop.clientWidth - 8;
        }

        pop.style.left = left + "px";
      }
    },

    "click .newGrain": function (event) {
      var id = event.currentTarget.id.split("-")[1];
      var action = UserActions.findOne(id);
      if (!action) {
        console.error("no such action: ", id);
        return;
      }

      // We need to ask the server to start a new grain, then browse to it.
      // TODO(soon):  Prompt for title.
      Meteor.call("newGrain", action.appid, action.command);
    }
  });

  Template.grainList.helpers({
    grains: function () {
      return Grains.find({userid: "testuser"}).fetch();
    },
    actions: function () {
      return UserActions.find({userid: "testuser"}).fetch();
    }
  });

  Template.install.events({
    "click #retry": function (event) {
      if (appDatabaseId) {
        Apps.remove(appDatabaseId);
        appDatabaseId = undefined;
      }
    },

    "click #cancelDownload": function (event) {
      if (activeAppId) {
        Meteor.call("cancelDownload", activeAppId);
        activeAppId = undefined;
      }
    },

    "click #confirmInstall": function (event) {
      var app = Apps.findOne(appDatabaseId);
      if (app) {
        var actions = app.manifest.actions;
        for (i in actions) {
          var action = actions[i];
          if ("none" in action.input) {
            UserActions.insert({
              userid: "testuser",
              appid: app.appid,
              title: action.title.defaultText,
              command: action.command
            });
          } else {
            // TODO(someday):  Implement actions with capability inputs.
          }
        }
      }
    }
  });
}

Router.map(function () {
  this.route("grain", {
    path: "/"
  });

  this.route("install", {
    path: "/install",
    data: function () {
      // TODO(soon):  Don't display until Apps subscription loaded.

      activeAppId = undefined;
      appDatabaseId = undefined;

      if (!this.params.appid) {
        // TODO(now):  Display upload page.
        return { error: "You must specify an app ID." };
      }

      if (this.params.url) {
        Meteor.call("ensureInstalled", this.params.appid, this.params.url);
      }

      var app = Apps.findOne({ appid: this.params.appid });
      if (app === undefined) {
        // Apparently, this app is not installed nor installing, which implies that no URL was
        // provided, which means we cannot install it.
        // TODO(now):  Display upload page, or at least don't display "try again" button.
        return { error: "Unknown app ID: " + this.params.appid +
                        "\nPerhaps it hasn't been uploaded?" };
      }

      activeAppId = this.params.appid;
      appDatabaseId = app._id;

      if (app.status !== "ready") {
        var progress;
        if (app.progress < 0) {
          progress = "";  // -1 means no progress to report
        } else if (app.progress > 1) {
          // Progress outside [0,1] indicates a byte count rather than a fraction.
          // TODO(cleanup):  This is pretty ugly.  What if exactly 1 byte had been downloaded?
          progress = Math.round(app.progress / 1024) + " KiB";
        } else {
          progress = Math.round(app.progress * 100) + "%";
        }

        return {
          step: app.status,
          progress: progress,
          error: app.status === "failed" ? app.error : null
        };
      }

      if (UserActions.findOne({ userid: "testuser", appid: this.params.appid })) {
        // This app appears to be installed already.
        return { step: "run" };
      } else {
        return { step: "confirm" };
      }
    }
  });
});
