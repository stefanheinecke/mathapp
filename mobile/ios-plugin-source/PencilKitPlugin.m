//
//  PencilKitPlugin.m
//  Objective-C Bruecke, damit Capacitors Laufzeitsystem das Swift-Plugin und seine Methode
//  findet (Capacitors Plugin-Registrierung basiert auf diesem Makro, nicht auf reinem Swift).
//
#import <Capacitor/Capacitor.h>

CAP_PLUGIN(PencilKitPlugin, "PencilKit",
  CAP_PLUGIN_METHOD(openCanvas, CAPPluginReturnPromise);
)
